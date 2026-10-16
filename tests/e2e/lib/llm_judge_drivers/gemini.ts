// tests/e2e/lib/llm_judge_drivers/gemini.ts — twin of gemini.sh (ADR 0009): API key, or OAuth
// refresh-token exchange then bearer auth against `generateContent`.

import fs from "node:fs";

import { assertDiag, dig, parseJson, readable, str, unsafePerms } from "../llm_judge.ts";
import type { Ctx, Driver, Preflight } from "../llm_judge.ts";
import { extractVerdict, judgeMessage, postWithRetry } from "./anthropic.ts";

const TOKEN_URL = "https://oauth2.googleapis.com/token";

async function refresh(ctx: Ctx, form: URLSearchParams): Promise<string> {
  const doFetch = ctx.deps.fetch ?? fetch;
  let res: Response;
  let text: string;
  try {
    res = await doFetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      redirect: "manual",
    });
    text = await res.text();
  } catch {
    ctx.err("# WARN gemini judge: OAuth token refresh failed (curl rc=7)\n");
    return "";
  }
  if (res.status >= 400) {
    ctx.err("# WARN gemini judge: OAuth token refresh failed (curl rc=22)\n");
    return "";
  }
  const access = str(dig(parseJson(text), "access_token"));
  if (access === "")
    ctx.err("# WARN gemini judge: OAuth token refresh failed (no access_token in response)\n");
  return access;
}

async function preflight(ctx: Ctx): Promise<Preflight> {
  if (ctx.mock) return { rc: 0, token: "mock" };
  const env = ctx.deps.env;
  const mode = ctx.cfg.authMode || "api_key";
  if (mode === "api_key") {
    const key = env[ctx.cfg.apiKeyEnv || "GEMINI_API_KEY"] ?? "";
    return key === "" ? { rc: 2 } : { rc: 0, token: key };
  }
  if (mode === "oauth") {
    const cred =
      env["GEMINI_CREDENTIALS_PATH"] || `${env["HOME"] ?? ""}/.crewrig-e2e/gemini/oauth_creds.json`;
    if (!readable(cred)) return { rc: 2 };
    const perms = unsafePerms(cred);
    if (perms !== undefined) {
      ctx.err(
        `# WARN llm_judge_driver_gemini: credentials file ${cred} has unsafe permissions (${perms}) — refusing\n`,
      );
      return { rc: 2 };
    }
    const json = parseJson(fs.readFileSync(cred, "utf8"));
    const field = (a: string, b: string) => str(dig(json, a)) || str(dig(json, b));
    const refreshToken = field("refreshToken", "refresh_token");
    const clientId = field("clientId", "client_id");
    const clientSecret = field("clientSecret", "client_secret");
    if (refreshToken === "" || clientId === "" || clientSecret === "") {
      ctx.err("# WARN gemini judge: oauth_creds.json missing refreshToken/clientId/clientSecret\n");
      return { rc: 2 };
    }
    const access = await refresh(
      ctx,
      new URLSearchParams([
        ["grant_type", "refresh_token"],
        ["refresh_token", refreshToken],
        ["client_id", clientId],
        ["client_secret", clientSecret],
      ]),
    );
    return access === "" ? { rc: 2 } : { rc: 0, token: access };
  }
  ctx.err(
    assertDiag(
      env,
      "gemini preflight",
      "JUDGE_AUTH_MODE in {oauth, api_key}",
      `JUDGE_AUTH_MODE=${mode}`,
    ),
  );
  return { rc: 1 };
}

async function call(
  ctx: Ctx,
  token: string,
  prompt: string,
  subject: string,
  criterion: string,
): Promise<string | undefined> {
  let text: string;
  if (ctx.mock) text = ctx.deps.env["E2E_JUDGE_MOCK_RESPONSE"] ?? "";
  else {
    const body = JSON.stringify({
      contents: [{ parts: [{ text: judgeMessage(prompt, subject, criterion) }] }],
      generationConfig: { temperature: ctx.cfg.temperature, maxOutputTokens: ctx.cfg.maxTokens },
    });
    const apiKey = (ctx.cfg.authMode || "api_key") === "api_key";
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (!apiKey) headers["authorization"] = `Bearer ${token}`;
    if (ctx.cfg.gcpProject !== "") headers["x-goog-user-project"] = ctx.cfg.gcpProject;
    const url = apiKey ? `${ctx.cfg.endpoint}?key=${token}` : ctx.cfg.endpoint;
    const raw = await postWithRetry(ctx, url, headers, body);
    if (raw === undefined) return undefined;
    ctx.bump();
    text = str(dig(parseJson(raw), "candidates", 0, "content", "parts", 0, "text"));
  }
  return extractVerdict(text);
}

export const geminiDriver: Driver = { preflight, call };

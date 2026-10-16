// tests/e2e/lib/llm_judge_drivers/claude-code.ts — twin of claude-code.sh (OAuth or API key,
// bearer auth against the Anthropic Messages API; ADR 0008).

import fs from "node:fs";

import { assertDiag, dig, parseJson, readable, str, unsafePerms } from "../llm_judge.ts";
import type { Ctx, Driver, Preflight } from "../llm_judge.ts";
import { extractVerdict, judgeMessage, postWithRetry } from "./anthropic.ts";

async function preflight(ctx: Ctx): Promise<Preflight> {
  if (ctx.mock) return { rc: 0, token: "mock" };
  const env = ctx.deps.env;
  const mode = ctx.cfg.authMode || "api_key";
  if (mode === "oauth") {
    const cred = env["CLAUDE_CREDENTIALS_PATH"] || `${env["HOME"] ?? ""}/.claude/.credentials.json`;
    if (!readable(cred)) return { rc: 2 };
    const perms = unsafePerms(cred);
    if (perms !== undefined) {
      ctx.err(
        `# WARN llm_judge_driver_claude-code: credentials file ${cred} has unsafe permissions (${perms}) — refusing\n`,
      );
      return { rc: 2 };
    }
    const json = parseJson(fs.readFileSync(cred, "utf8"));
    const token = str(dig(json, "claudeAiOauth", "accessToken"));
    if (token === "") return { rc: 2 };
    const expires = str(dig(json, "claudeAiOauth", "expiresAt"));
    if (!/^[0-9]+$/.test(expires)) {
      ctx.err(
        "# WARN llm_judge_driver_claude-code: OAuth credentials missing or non-integer expiresAt — refusing\n",
      );
      return { rc: 2 };
    }
    if (Number(expires) < Math.floor(ctx.deps.now() / 1000) * 1000) {
      ctx.err("# WARN claude-code judge: OAuth token expired (re-run `task e2e:auth:claude`)\n");
      return { rc: 2 };
    }
    return { rc: 0, token };
  }
  if (mode === "api_key") {
    const key = env[ctx.cfg.apiKeyEnv || "ANTHROPIC_JUDGE_API_KEY"] ?? "";
    return key === "" ? { rc: 2 } : { rc: 0, token: key };
  }
  ctx.err(
    assertDiag(
      env,
      "claude-code preflight",
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
      model: ctx.cfg.model,
      max_tokens: ctx.cfg.maxTokens,
      temperature: ctx.cfg.temperature,
      messages: [{ role: "user", content: judgeMessage(prompt, subject, criterion) }],
    });
    const raw = await postWithRetry(
      ctx,
      ctx.cfg.endpoint,
      { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body,
    );
    if (raw === undefined) return undefined;
    ctx.bump();
    text = str(dig(parseJson(raw), "content", 0, "text"));
  }
  return extractVerdict(text);
}

export const claudeCodeDriver: Driver = { preflight, call };

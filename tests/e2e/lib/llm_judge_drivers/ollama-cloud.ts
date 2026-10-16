// tests/e2e/lib/llm_judge_drivers/ollama-cloud.ts — twin of ollama-cloud.sh (ADR 0009): API key,
// or an Ed25519-signed JWT assertion (node:crypto, no openssl) exchanged for a bearer token.

import crypto from "node:crypto";
import fs from "node:fs";

import { assertDiag, dig, parseJson, readable, str, unsafePerms } from "../llm_judge.ts";
import type { Ctx, Driver, Preflight } from "../llm_judge.ts";
import { extractVerdict, judgeMessage, postWithRetry } from "./anthropic.ts";

const b64u = (s: string | Buffer) => Buffer.from(s).toString("base64url");
const P = "# WARN llm_judge_driver_ollama-cloud:";

async function exchange(ctx: Ctx, endpoint: string, jwt: string): Promise<string> {
  const doFetch = ctx.deps.fetch ?? fetch;
  let text = "";
  try {
    const res = await doFetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
      redirect: "manual",
    });
    text = await res.text();
  } catch {
    text = "";
  }
  if (text === "") {
    ctx.err(`${P} token exchange failed at ${endpoint}\n`);
    return "";
  }
  const json = parseJson(text);
  const token = str(dig(json, "access_token")) || str(dig(json, "token"));
  if (token === "") ctx.err(`${P} token exchange response did not include access_token/token\n`);
  return token;
}

async function preflight(ctx: Ctx): Promise<Preflight> {
  if (ctx.mock) return { rc: 0, token: "mock" };
  const env = ctx.deps.env;
  const mode = ctx.cfg.authMode || "api_key";
  if (mode === "api_key") {
    const key = env[ctx.cfg.apiKeyEnv || "OLLAMA_API_KEY"] ?? "";
    return key === "" ? { rc: 2 } : { rc: 0, token: key };
  }
  if (mode === "keypair") {
    const keyPath =
      env["OLLAMA_KEYPAIR_PATH"] ||
      `${env["CREWRIG_E2E_HOME"] || `${env["HOME"] ?? ""}/.crewrig-e2e`}/ollama/id_ed25519`;
    if (!readable(keyPath)) return { rc: 2 };
    const perms = unsafePerms(keyPath);
    if (perms !== undefined) {
      ctx.err(`${P} keypair file ${keyPath} has unsafe permissions (${perms}) — refusing\n`);
      return { rc: 2 };
    }
    const now = Math.floor(ctx.deps.now() / 1000);
    const signingInput = `${b64u('{"alg":"EdDSA","typ":"JWT"}')}.${b64u(
      JSON.stringify({ iss: "crewrig-e2e", aud: "api.ollama.ai", iat: now, exp: now + 60 }),
    )}`;
    let sig = "";
    try {
      const key = crypto.createPrivateKey(fs.readFileSync(keyPath));
      sig = b64u(crypto.sign(null, Buffer.from(signingInput), key));
    } catch {
      sig = "";
    }
    if (sig === "") {
      ctx.err(`${P} Ed25519 signing failed\n`);
      return { rc: 2 };
    }
    const endpoint = env["OLLAMA_TOKEN_ENDPOINT"] || "https://api.ollama.ai/v1/auth/token";
    const token = await exchange(ctx, endpoint, `${signingInput}.${sig}`);
    return token === "" ? { rc: 2 } : { rc: 0, token };
  }
  ctx.err(
    assertDiag(
      env,
      "ollama-cloud preflight",
      "JUDGE_AUTH_MODE in {api_key, keypair}",
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
  let endpoint = ctx.cfg.endpoint;
  if (endpoint === "" || endpoint === "https://api.anthropic.com/v1/messages")
    endpoint =
      ctx.deps.env["OLLAMA_COMPLETIONS_ENDPOINT"] || "https://api.ollama.ai/v1/chat/completions";
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
      endpoint,
      { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body,
    );
    if (raw === undefined) return undefined;
    ctx.bump();
    text = str(dig(parseJson(raw), "choices", 0, "message", "content"));
  }
  return extractVerdict(text);
}

export const ollamaCloudDriver: Driver = { preflight, call };

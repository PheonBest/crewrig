// tests/e2e/lib/llm_judge_drivers/anthropic.ts — twin of anthropic.sh (Anthropic Messages API).

import { dig, parseJson, str } from "../llm_judge.ts";
import type { Ctx, Driver, Preflight } from "../llm_judge.ts";

// Shared by the three Messages-shaped drivers (claude-code, ollama-cloud import these).
export function judgeMessage(prompt: string, subject: string, criterion: string): string {
  return (
    "You are an LLM judge for an end-to-end test framework. " +
    "Read the PROMPT, SUBJECT, and CRITERION below, then respond with EXACTLY one line in the form:\n\n" +
    "  VERDICT=<PASS|FAIL|UNCERTAIN> CONF=<0.00-1.00>\n\n" +
    "No prose, no markdown, no trailing text.\n\n" +
    `PROMPT:\n${prompt}\n\nSUBJECT:\n${subject}\n\nCRITERION:\n${criterion}`
  );
}

export function extractVerdict(text: string): string | undefined {
  return /VERDICT=(?:PASS|FAIL|UNCERTAIN)[ \t\r\f\v]+CONF=\d+(?:\.\d+)?/.exec(text)?.[0];
}

/** POST with one retry (2 attempts, 1 s sleep after each failure); the body text, or undefined. */
export async function postWithRetry(
  ctx: Ctx,
  url: string,
  headers: Record<string, string>,
  body: string,
): Promise<string | undefined> {
  const doFetch = ctx.deps.fetch ?? fetch;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await doFetch(url, { method: "POST", headers, body, redirect: "manual" });
      const text = await res.text();
      if (res.status < 400) return text;
    } catch {
      // network failure: retried like a curl failure
    }
    await ctx.deps.sleep(1000);
  }
  return undefined;
}

async function preflight(ctx: Ctx): Promise<Preflight> {
  if (ctx.mock) return { rc: 0, token: "mock" };
  const key = ctx.deps.env[ctx.cfg.apiKeyEnv || "ANTHROPIC_JUDGE_API_KEY"] ?? "";
  return key === "" ? { rc: 2 } : { rc: 0, token: key };
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
      { "x-api-key": token, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body,
    );
    if (raw === undefined) return undefined;
    ctx.bump();
    text = str(dig(parseJson(raw), "content", 0, "text"));
  }
  return extractVerdict(text);
}

export const anthropicDriver: Driver = { preflight, call };

// e2e-llm-judge-fixtures.ts — shared fixtures of the e2e-llm-judge-lib suites (spec 0261 R19):
// effective.json builders, a queue-driven fetch stand-in for the Anthropic endpoint, and a runner.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { llmJudge } from "../../../tests/e2e/lib/llm_judge.ts";
import type { JudgeResult } from "../../../tests/e2e/lib/llm_judge.ts";

export interface Fixture {
  readonly tmp: string;
  readonly prompt: string;
  readonly subject: string;
  newDir(name: string): string;
  cleanup(): void;
}

export function makeFixture(): Fixture {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-llm-judge-"));
  const prompt = path.join(tmp, "prompt");
  const subject = path.join(tmp, "subject");
  fs.writeFileSync(prompt, "judge politely\n");
  fs.writeFileSync(subject, "the response text\n");
  return {
    tmp,
    prompt,
    subject,
    newDir(name) {
      const d = path.join(tmp, name);
      fs.mkdirSync(d, { recursive: true });
      return d;
    },
    cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }),
  };
}

export interface JudgeFields {
  backend?: string;
  api_key_env?: string;
  auth_mode?: string;
  gcp_project?: string;
  max_calls?: number;
  temperature?: number;
  model?: string;
  endpoint?: string;
}

export function writeEffective(dir: string, fields: JudgeFields): void {
  const judge = {
    backend: "anthropic",
    model: "claude-sonnet-4-6",
    api_key_env: "ANTHROPIC_JUDGE_API_KEY",
    strict: false,
    max_calls: 30,
    endpoint: "https://api.anthropic.com/v1/messages",
    max_tokens: 256,
    temperature: 0.0,
    ...fields,
  };
  fs.writeFileSync(path.join(dir, "effective.json"), JSON.stringify({ judge }));
}

export interface FakeFetch {
  readonly fetch: typeof fetch;
  readonly requests: { url: string; headers: Record<string, string>; body: string }[];
  readonly remaining: () => number;
}

/** Queue of response lines; "MALFORMED" yields a 200 without a verdict. */
export function queueFetch(lines: readonly string[]): FakeFetch {
  const queue = [...lines];
  const requests: FakeFetch["requests"] = [];
  const fake = (async (url: string, init: RequestInit) => {
    requests.push({
      url: String(url),
      headers: init.headers as Record<string, string>,
      body: String(init.body),
    });
    const line = queue.shift() ?? "MALFORMED";
    const text = line === "MALFORMED" ? "no verdict here" : line;
    return new Response(JSON.stringify({ content: [{ type: "text", text }] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetch: fake, requests, remaining: () => queue.length };
}

export function run(
  fx: Fixture,
  env: Record<string, string | undefined>,
  fetchImpl?: typeof fetch,
): Promise<JudgeResult> {
  return llmJudge(
    {
      env,
      now: () => Date.now(),
      sleep: async () => {},
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
    },
    fx.prompt,
    fx.subject,
    "criterion",
  );
}

// e2e-oracle-judge-cases-kit.ts — builders shared by the judge case files (spec 0261 R9).

import { ENDPOINT_PATHS, replyFor } from "./e2e-judge-endpoints.ts";
import type { CannedReply, EndpointKey } from "./e2e-judge-endpoints.ts";

export const ARGS = {
  prompt: "judge politely\n",
  answer: "the response text\n",
  criterion: "is it polite?",
} as const;

export const FAR_FUTURE_MS = "4102444800000";

/** Wire name of the model line for a verdict; `MALFORMED` becomes a reply the parser rejects. */
export function texts(endpoint: EndpointKey, ...lines: readonly string[]): CannedReply[] {
  return lines.map((l) => replyFor(endpoint, l === "MALFORMED" ? "no verdict here" : l));
}

export function verdict(v: "PASS" | "FAIL" | "UNCERTAIN", conf: string): string {
  return `VERDICT=${v} CONF=${conf}`;
}

const DEFAULTS: Readonly<Record<string, Record<string, unknown>>> = {
  anthropic: {
    model: "claude-sonnet-4-6",
    api_key_env: "ANTHROPIC_JUDGE_API_KEY",
    auth_mode: "api_key",
  },
  "claude-code": {
    model: "claude-sonnet-4-6",
    api_key_env: "ANTHROPIC_JUDGE_API_KEY",
    auth_mode: "oauth",
  },
  gemini: { model: "gemini-2.5-flash", api_key_env: "GEMINI_API_KEY", auth_mode: "api_key" },
  "ollama-cloud": { model: "gpt-oss:120b", api_key_env: "OLLAMA_API_KEY", auth_mode: "api_key" },
};

const ENDPOINT_OF: Readonly<Record<string, EndpointKey>> = {
  anthropic: "anthropic",
  "claude-code": "claude-code",
  gemini: "gemini",
  "ollama-cloud": "ollama-cloud",
};

/** The `[judge]` object of a case: the defaults.toml shape with the endpoint on the stand-in. */
export function judgeConfig(
  backend: string,
  extra: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  const key = ENDPOINT_OF[backend] ?? "anthropic";
  return {
    backend,
    ...(DEFAULTS[backend] ?? DEFAULTS["anthropic"]),
    strict: false,
    max_calls: 30,
    endpoint: `{BASE}${ENDPOINT_PATHS[key]}`,
    max_tokens: 256,
    temperature: 0.0,
    ...extra,
  };
}

export function creds(path: string, json: unknown, mode = 0o600) {
  return { path, content: `${JSON.stringify(json)}\n`, mode };
}

export const CLAUDE_CREDS_PATH = ".claude/.credentials.json";
export const GEMINI_CREDS_PATH = ".crewrig-e2e/gemini/oauth_creds.json";
export const OLLAMA_KEY_PATH = ".crewrig-e2e/ollama/id_ed25519";

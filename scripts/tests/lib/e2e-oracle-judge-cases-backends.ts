// e2e-oracle-judge-cases-backends.ts — claude-code, gemini and ollama-cloud rows of Table 1
// (test-e2e-llm-judge-lib). Credentials live in the scratch HOME at the drivers' default paths.

import {
  ARGS,
  CLAUDE_CREDS_PATH,
  FAR_FUTURE_MS,
  GEMINI_CREDS_PATH,
  OLLAMA_KEY_PATH,
  creds,
  judgeConfig,
  texts,
  verdict as v,
} from "./e2e-oracle-judge-cases-kit.ts";
import { replyFor } from "./e2e-judge-endpoints.ts";
import type { JudgeCase } from "./e2e-oracle-judge-types.ts";

const PP = [v("PASS", "0.9"), v("PASS", "0.9")] as const;
const PASS2 = { rc: 0, stdout: "VERDICT=PASS confidence=0.90", count: "2\n" } as const;
const missing = (backend: string) =>
  `# WARN llm_judge UNCERTAIN reason=auth-missing backend=${backend}`;
const UNC0 = "VERDICT=UNCERTAIN confidence=0.00";
const hard = (backend: string) => `preflight success for backend=${backend}`;

function claude(id: string, p: Partial<JudgeCase> & Pick<JudgeCase, "expect">): JudgeCase {
  return {
    id: `claude-code/${id}`,
    backend: "claude-code",
    effectiveJudge: judgeConfig("claude-code"),
    responses: {},
    args: ARGS,
    ...p,
  };
}
function gemini(id: string, p: Partial<JudgeCase> & Pick<JudgeCase, "expect">): JudgeCase {
  return {
    id: `gemini/${id}`,
    backend: "gemini",
    effectiveJudge: judgeConfig("gemini"),
    responses: {},
    args: ARGS,
    ...p,
  };
}
function ollama(id: string, p: Partial<JudgeCase> & Pick<JudgeCase, "expect">): JudgeCase {
  return {
    id: `ollama-cloud/${id}`,
    backend: "ollama-cloud",
    effectiveJudge: judgeConfig("ollama-cloud"),
    responses: {},
    args: ARGS,
    ...p,
  };
}

const GCREDS = {
  refresh_token: "fake-refresh",
  client_id: "fake-client",
  client_secret: "fake-secret",
};
const OLLAMA_ENV = { OLLAMA_TOKEN_ENDPOINT: "{BASE}/ollama-token" };

export const BACKEND_CASES: readonly JudgeCase[] = [
  claude("oauth-missing-file", {
    expect: { rc: 0, stdout: UNC0, stderrIncludes: [missing("claude-code")], requests: 0 },
  }),
  claude("oauth-null-token", {
    seed: [
      creds(CLAUDE_CREDS_PATH, {
        claudeAiOauth: { accessToken: null, expiresAt: Number(FAR_FUTURE_MS) },
      }),
    ],
    expect: { rc: 0, stdout: UNC0, stderrIncludes: [missing("claude-code")], requests: 0 },
  }),
  claude("oauth-expired", {
    seed: [
      creds(CLAUDE_CREDS_PATH, {
        claudeAiOauth: { accessToken: "fake-oauth-token", expiresAt: 1000 },
      }),
    ],
    expect: {
      rc: 0,
      stdout: UNC0,
      stderrIncludes: ["OAuth token expired", missing("claude-code")],
      requests: 0,
    },
  }),
  claude("unknown-auth-mode", {
    effectiveJudge: judgeConfig("claude-code", { auth_mode: "bogus" }),
    expect: {
      rc: 1,
      stdout: "",
      stderrIncludes: ["JUDGE_AUTH_MODE=bogus", hard("claude-code")],
      requests: 0,
    },
  }),
  claude("oauth-happy", {
    seed: [
      creds(CLAUDE_CREDS_PATH, {
        claudeAiOauth: { accessToken: "fake-oauth-token", expiresAt: Number(FAR_FUTURE_MS) },
      }),
    ],
    responses: { "claude-code": texts("claude-code", ...PP) },
    expect: { ...PASS2, requests: 2 },
  }),
  gemini("api-key-missing", {
    expect: { rc: 0, stdout: UNC0, stderrIncludes: [missing("gemini")], requests: 0 },
  }),
  gemini("api-key-happy", {
    env: { GEMINI_API_KEY: "dummy-gemini-key" },
    responses: { gemini: texts("gemini", ...PP) },
    expect: { ...PASS2, requests: 2 },
  }),
  gemini("oauth-missing-file", {
    effectiveJudge: judgeConfig("gemini", { auth_mode: "oauth" }),
    expect: { rc: 0, stdout: UNC0, stderrIncludes: [missing("gemini")], requests: 0 },
  }),
  gemini("oauth-unsafe-permissions", {
    effectiveJudge: judgeConfig("gemini", { auth_mode: "oauth" }),
    seed: [creds(GEMINI_CREDS_PATH, GCREDS, 0o644)],
    posixOnly: true,
    expect: {
      rc: 0,
      stdout: UNC0,
      stderrIncludes: ["unsafe permissions (644)", missing("gemini")],
      requests: 0,
    },
  }),
  gemini("oauth-happy", {
    effectiveJudge: judgeConfig("gemini", { auth_mode: "oauth" }),
    seed: [creds(GEMINI_CREDS_PATH, GCREDS)],
    responses: {
      "gemini-token": [replyFor("gemini-token", "fake-access-token")],
      gemini: texts("gemini", ...PP),
    },
    expect: { ...PASS2, requests: 3 },
  }),
  gemini("unknown-auth-mode", {
    effectiveJudge: judgeConfig("gemini", { auth_mode: "bogus" }),
    expect: {
      rc: 1,
      stdout: "",
      stderrIncludes: ["JUDGE_AUTH_MODE=bogus", hard("gemini")],
      requests: 0,
    },
  }),
  gemini("gcp-project-forwarded", {
    effectiveJudge: judgeConfig("gemini", { gcp_project: "my-quota-project" }),
    env: { GEMINI_API_KEY: "dummy-gemini-key" },
    responses: { gemini: texts("gemini", ...PP) },
    expect: { ...PASS2, requests: 2 },
  }),
  ollama("api-key-missing", {
    expect: { rc: 0, stdout: UNC0, stderrIncludes: [missing("ollama-cloud")], requests: 0 },
  }),
  ollama("api-key-happy", {
    env: { OLLAMA_API_KEY: "dummy-ollama-key" },
    responses: { "ollama-cloud": texts("ollama-cloud", ...PP) },
    expect: { ...PASS2, requests: 2 },
  }),
  ollama("keypair-missing", {
    effectiveJudge: judgeConfig("ollama-cloud", { auth_mode: "keypair" }),
    expect: { rc: 0, stdout: UNC0, stderrIncludes: [missing("ollama-cloud")], requests: 0 },
  }),
  ollama("keypair-happy", {
    effectiveJudge: judgeConfig("ollama-cloud", { auth_mode: "keypair" }),
    seed: [{ path: OLLAMA_KEY_PATH, content: "{ED25519_KEY}", mode: 0o600 }],
    env: OLLAMA_ENV,
    responses: {
      "ollama-token": [replyFor("ollama-token", "fake-ollama-token")],
      "ollama-cloud": texts("ollama-cloud", ...PP),
    },
    nonDeterministicSignature: true,
    opensslFileShim: true,
    expect: { ...PASS2, requests: 3 },
  }),
  ollama("unknown-auth-mode", {
    effectiveJudge: judgeConfig("ollama-cloud", { auth_mode: "bogus" }),
    expect: {
      rc: 1,
      stdout: "",
      stderrIncludes: ["JUDGE_AUTH_MODE=bogus", hard("ollama-cloud")],
      requests: 0,
    },
  }),
];

// e2e-oracle-judge-cases.ts — registry of judge cases: core, quorum and anthropic rows of Table 1
// of the PLAN v3 comment (test-e2e-llm-judge-lib). The other backends sit in
// e2e-oracle-judge-cases-backends.ts. Each row stands for one case of
// scripts/tests/test-e2e-llm-judge-lib.sh, rerun against the HTTP stand-in.

import { BACKEND_CASES } from "./e2e-oracle-judge-cases-backends.ts";
import { ARGS, judgeConfig, texts, verdict as v } from "./e2e-oracle-judge-cases-kit.ts";
import type { JudgeCase } from "./e2e-oracle-judge-types.ts";

const KEY = { ANTHROPIC_JUDGE_API_KEY: "dummy-key" };
const WARN_UNC = "# WARN llm_judge UNCERTAIN";

function quorum(
  id: string,
  lines: readonly string[],
  expect: JudgeCase["expect"],
  opts: Partial<JudgeCase> = {},
): JudgeCase {
  return {
    id: `quorum/${id}`,
    backend: "anthropic",
    effectiveJudge: judgeConfig("anthropic"),
    env: KEY,
    responses: { anthropic: texts("anthropic", ...lines) },
    args: ARGS,
    expect,
    ...opts,
  };
}

const AUTH_MISSING = (backend: string) =>
  `# WARN llm_judge UNCERTAIN reason=auth-missing backend=${backend}`;

export const CORE_CASES: readonly JudgeCase[] = [
  {
    id: "auth-missing/default",
    backend: "anthropic",
    effectiveJudge: judgeConfig("anthropic"),
    responses: {},
    args: ARGS,
    expect: {
      rc: 0,
      stdout: "VERDICT=UNCERTAIN confidence=0.00",
      stderrIncludes: [AUTH_MISSING("anthropic")],
      requests: 0,
    },
  },
  {
    id: "auth-missing/strict",
    backend: "anthropic",
    effectiveJudge: judgeConfig("anthropic"),
    strict: true,
    responses: {},
    args: ARGS,
    expect: {
      rc: 1,
      stdout: "VERDICT=UNCERTAIN confidence=0.00",
      stderrIncludes: ["# FAIL llm_judge", "backend=anthropic auth-missing"],
      requests: 0,
    },
  },
  quorum("pass-pass", [v("PASS", "0.9"), v("PASS", "0.7")], {
    rc: 0,
    stdout: "VERDICT=PASS confidence=0.80",
    requests: 2,
    count: "2\n",
  }),
  quorum("fail-fail", [v("FAIL", "0.8"), v("FAIL", "0.6")], {
    rc: 1,
    stdout: "VERDICT=FAIL confidence=0.70",
    stderrIncludes: ["# FAIL llm_judge", "VERDICT=FAIL confidence=0.70"],
    requests: 2,
    count: "2\n",
  }),
  quorum("pass-fail-pass", [v("PASS", "0.9"), v("FAIL", "0.5"), v("PASS", "0.7")], {
    rc: 0,
    stdout: "VERDICT=PASS confidence=0.70",
    requests: 3,
    count: "3\n",
  }),
  quorum("no-majority", [v("PASS", "0.6"), v("FAIL", "0.6"), v("UNCERTAIN", "0.5")], {
    rc: 0,
    stdout: "VERDICT=UNCERTAIN confidence=0.57",
    stderrIncludes: [WARN_UNC, "slots=PASS FAIL UNCERTAIN"],
    requests: 3,
    count: "3\n",
  }),
  quorum(
    "uncertain-strict",
    [v("PASS", "0.6"), v("FAIL", "0.6"), v("UNCERTAIN", "0.5")],
    {
      rc: 1,
      stdout: "VERDICT=UNCERTAIN confidence=0.57",
      stderrIncludes: ["strict mode upgrades UNCERTAIN to FAIL"],
      requests: 3,
      count: "3\n",
    },
    { strict: true },
  ),
  quorum("two-of-three-malformed", [v("PASS", "0.7"), "MALFORMED", "MALFORMED"], {
    rc: 0,
    stdout: "VERDICT=UNCERTAIN confidence=0.23",
    stderrIncludes: [WARN_UNC],
    requests: 3,
    count: "3\n",
  }),
  quorum(
    "temperature-forwarded",
    [v("PASS", "0.9"), v("PASS", "0.9")],
    { rc: 0, stdout: "VERDICT=PASS confidence=0.90", requests: 2, count: "2\n" },
    { effectiveJudge: judgeConfig("anthropic", { temperature: 0.5 }) },
  ),
  {
    id: "backend/unknown",
    backend: "nonexistent",
    effectiveJudge: judgeConfig("nonexistent"),
    env: KEY,
    responses: {},
    args: ARGS,
    expect: {
      rc: 1,
      stdout: "",
      stderrIncludes: ["# FAIL", "driver for backend=nonexistent"],
      requests: 0,
    },
  },
  {
    id: "anthropic/api-key-parity",
    backend: "anthropic",
    effectiveJudge: judgeConfig("anthropic", { auth_mode: "api_key" }),
    env: KEY,
    responses: { anthropic: texts("anthropic", v("PASS", "0.9"), v("PASS", "0.9")) },
    args: ARGS,
    expect: { rc: 0, stdout: "VERDICT=PASS confidence=0.90", requests: 2, count: "2\n" },
  },
  {
    id: "max-calls/cap-reached",
    backend: "anthropic",
    effectiveJudge: judgeConfig("anthropic", { max_calls: 1 }),
    env: KEY,
    preCount: 1,
    responses: {
      anthropic: texts("anthropic", v("PASS", "0.9"), v("PASS", "0.9"), v("PASS", "0.9")),
    },
    args: ARGS,
    expect: {
      rc: 1,
      stdout: "",
      stderrIncludes: ["per-run cap exceeded (count=1)", "judge.count"],
      requests: 0,
      count: "1\n",
    },
  },
];

export const JUDGE_CASES: readonly JudgeCase[] = [...CORE_CASES, ...BACKEND_CASES];

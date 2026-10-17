// e2e-judge-run.ts — the shared constants and the expected-shape check of the judge oracle (spec 0261 R9).
// The shell judge run that used to live here is removed with tests/e2e/lib/llm_judge.sh; the recorded
// goldens under fixtures/e2e-oracle/judge are the shell's recordings.

import type { JudgeCase, JudgeTuple } from "./e2e-oracle-judge-types.ts";

export const TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Violations of the case's declared expected shape; empty when the run matches. */
export function checkExpect(c: JudgeCase, t: JudgeTuple): string[] {
  const bad: string[] = [];
  const e = c.expect;
  if (t.rc !== e.rc) bad.push(`rc ${t.rc} != ${e.rc}`);
  if (t.stdout !== e.stdout)
    bad.push(`stdout ${JSON.stringify(t.stdout)} != ${JSON.stringify(e.stdout)}`);
  for (const s of e.stderrIncludes ?? [])
    if (!t.stderr.includes(s)) bad.push(`stderr lacks ${JSON.stringify(s)}`);
  if (t.requests.length !== e.requests) bad.push(`requests ${t.requests.length} != ${e.requests}`);
  if (e.count !== undefined && t.files["judge.count"] !== e.count)
    bad.push(`judge.count ${JSON.stringify(t.files["judge.count"])} != ${JSON.stringify(e.count)}`);
  if (t.requests.some((r) => r.unqueued)) bad.push("a request found the stand-in queue empty");
  return bad;
}

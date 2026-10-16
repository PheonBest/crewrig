// probe_b_resolve.ts — TypeScript twin of tests/e2e/lib/probe_b_resolve.sh (probe B per-cell
// verdict resolver). Change both, and keep them equal. Only the literal "true" counts as true.
// A missing argument reproduces bash's `set -o nounset` abort (status 127, line 22).

import type { ProbeResult } from "./probe_a_resolve.ts";

const LOCAL_LINE = 22;

export function resolveProbeBCell(args: readonly string[], libPath: string): ProbeResult {
  for (let i = 0; i < 2; i++) {
    if (i >= args.length) {
      return {
        rc: 127,
        stdout: "",
        stderr: `${libPath}: line ${LOCAL_LINE}: $${i + 1}: unbound variable\n`,
      };
    }
  }
  const [nonceObserved, baselineObserved] = args;
  const verdict =
    nonceObserved === "true"
      ? "consumed"
      : baselineObserved === "true"
        ? "not-consumed"
        : "indeterminate";
  return { rc: 0, stdout: `${verdict}\n`, stderr: "" };
}

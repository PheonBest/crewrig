// probe_c_resolve.ts — TypeScript twin of tests/e2e/lib/probe_c_resolve.sh (probe C verdict
// resolvers: cells C1 and C2, and the shared guidance resolver behind C3 and C4). Change both,
// and keep them equal. Only the literal "true" counts as true. A missing argument reproduces
// bash's `set -o nounset` abort (status 127) at the line of the shell function's `local`.

import type { ProbeResult } from "./probe_a_resolve.ts";

const C1_LINE = 18;
const C2_LINE = 37;
const GUIDANCE_LINE = 56;

function unbound(
  args: readonly string[],
  count: number,
  line: number,
  libPath: string,
): ProbeResult | null {
  if (args.length >= count) return null;
  return {
    rc: 127,
    stdout: "",
    stderr: `${libPath}: line ${line}: $${args.length + 1}: unbound variable\n`,
  };
}

const verdict = (v: string): ProbeResult => ({ rc: 0, stdout: `${v}\n`, stderr: "" });

function resolveCell(
  args: readonly string[],
  line: number,
  libPath: string,
  ignored: string,
  disturbed: string,
): ProbeResult {
  const missing = unbound(args, 4, line, libPath);
  if (missing !== null) return missing;
  const [baseline, target, responded, symptom] = args;
  if (baseline !== "true") return verdict("INDETERMINATE|session-broken-or-unresponsive");
  if (target === "true") return verdict(ignored);
  if (symptom === "true" || responded === "false") return verdict(disturbed);
  return verdict("INDETERMINATE|no-discriminating-observation");
}

export function resolveProbeC1(args: readonly string[], libPath: string): ProbeResult {
  return resolveCell(
    args,
    C1_LINE,
    libPath,
    "IGNORED|prose-inert-subagent-responded",
    "DISTURBED|prose-disturbs-routing",
  );
}

export function resolveProbeC2(args: readonly string[], libPath: string): ProbeResult {
  return resolveCell(
    args,
    C2_LINE,
    libPath,
    "IGNORED|effort-frontmatter-inert",
    "DISTURBED|effort-frontmatter-disturbs-routing",
  );
}

// `tr '[:upper:]' '[:lower:]'` under the C locale folds ASCII letters only.
const lowerAscii = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

export function resolveProbeCGuidance(args: readonly string[], libPath: string): ProbeResult {
  const missing = unbound(args, 6, GUIDANCE_LINE, libPath);
  if (missing !== null) return missing;
  const [baseline, target, responded, observed, requested, control] = args;
  if (baseline !== "true") return verdict("INDETERMINATE|session-broken-or-unresponsive");
  if (target !== "true") {
    return responded === "false"
      ? verdict("DISTURBED|guidance-caused-failure")
      : verdict("INDETERMINATE|target-nonce-missing");
  }
  if (observed === "") return verdict("INDETERMINATE|no-model-label-in-spawn-marker");
  const obs = lowerAscii(observed);
  const req = lowerAscii(requested);
  const ctrl = lowerAscii(control);
  if (obs.includes(req)) return verdict("HONOURED|requested-model-selected");
  if ((ctrl !== "" && obs.includes(ctrl)) || !obs.includes(req)) {
    return verdict("IGNORED|session-or-default-model-selected");
  }
  return verdict("INDETERMINATE|unrecognized-model-observation");
}

/** `e2e_probe_c_resolve_c3` and `_c4` delegate to the guidance resolver unchanged. */
export const resolveProbeC3 = resolveProbeCGuidance;
export const resolveProbeC4 = resolveProbeCGuidance;

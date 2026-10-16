// probe_a_resolve.ts — TypeScript twin of tests/e2e/lib/probe_a_resolve.sh (probe A verdict
// resolver, spec 0194 R9). Change both, and keep them equal. A pure function over five
// string-typed booleans: only the literal "true" counts as true.
//
// The shell ran under `set -o nounset`: a missing argument aborted the call with bash's
// `<lib>: line 48: $K: unbound variable` and status 127. The twin reproduces that result;
// `libPath` is the path bash would have printed for the shell library.

/** What the shell function wrote and returned. */
export interface ProbeResult {
  readonly rc: number;
  readonly stdout: string;
  readonly stderr: string;
}

const LOCAL_LINE = 48;

export function resolveProbeA(args: readonly string[], libPath: string): ProbeResult {
  for (let i = 0; i < 5; i++) {
    if (i >= args.length) {
      return {
        rc: 127,
        stdout: "",
        stderr: `${libPath}: line ${LOCAL_LINE}: $${i + 1}: unbound variable\n`,
      };
    }
  }
  const [control, efficacy, efficacySymptom, bearing, bearingSymptom] = args;
  const verdict = (v: string): ProbeResult => ({ rc: 0, stdout: `${v}\n`, stderr: "" });
  if (control !== "true") return verdict("INDETERMINATE|surface-not-read-or-session-broken");
  if (efficacy === "true") return verdict("INDETERMINATE|hint-inert-trigger-not-armed");
  if (efficacySymptom !== "true") return verdict("INDETERMINATE|efficacy-leg-failed-unexplained");
  if (bearing === "true") return verdict("BUG-ABSENT|");
  if (bearingSymptom === "true") return verdict("BUG-PRESENT|");
  return verdict("INDETERMINATE|no-discriminating-observation");
}

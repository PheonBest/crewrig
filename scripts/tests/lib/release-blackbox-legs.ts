// release-blackbox-legs.ts — the implementations the release driver black-box suites run against
// (spec 0257 R22). Every assertion is leg-agnostic: a leg is only the entry the sandbox starts.

// The TypeScript leg is appended by the entries pull request, with no assertion edit.
export const LEGS: readonly { name: "shell" | "ts" }[] = [{ name: "shell" }];

/** Call `define` once per leg, so each case registers a test per implementation. */
export function forEachLeg(define: (leg: "shell" | "ts") => void): void {
  for (const leg of LEGS) define(leg.name);
}

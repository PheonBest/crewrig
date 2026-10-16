// governance-cases.ts — the differential case table of the 18 governance checks (spec 0259
// R1 and R26, PLAN v2). One row per check; the PR groups of the plan select their own rows so
// each `governance-<group>-differential.test.ts` runs only the checks its PR ports.

import type { TeeCase } from "./governance-sandbox.ts";

export type GovernanceGroup =
  | "repo-scans"
  | "version-checks"
  | "extension-hook-checks"
  | "metadata-routing-layout"
  | "figure-labels"
  | "foundations";

/** A host tool the shell leg shells out to (skipped on a host lacking it, FAIL when CI is set). */
export type Tool = "jq" | "yq" | "python3" | "tesseract";

export interface GovernanceCase extends TeeCase {
  readonly group: GovernanceGroup;
  /** The unchanged Bash suite `scripts/tests/test-check-<x>.sh`, or null when none exists. */
  readonly suite: string | null;
  /** Argv of the real-repository leg. */
  readonly realRepoArgv: readonly string[];
  /** Tools the shell legs need; absent tool = skip locally, fail under CI. */
  readonly needs: readonly Tool[];
  /** The real-repo leg needs a HEAD commit (base-ref diff, `git ls-tree HEAD`) in the sandbox. */
  readonly needsCommit?: boolean;
}

const suite = (x: string): string => `test-check-${x}.sh`;

/** Base-ref checks: a sandbox with one commit, compared with itself, resolves `HEAD`. */
const BASE = { realRepoArgv: ["HEAD"], needsCommit: true } as const;

export const GOVERNANCE_CASES: readonly GovernanceCase[] = [
  // repo-scans (PA)
  {
    name: "check-no-machine-paths",
    group: "repo-scans",
    suite: suite("no-machine-paths"),
    realRepoArgv: [],
    needs: [],
  },
  {
    name: "check-test-wiring",
    group: "repo-scans",
    suite: suite("test-wiring"),
    realRepoArgv: [],
    needs: [],
  },
  {
    name: "check-test-strays",
    group: "repo-scans",
    suite: suite("test-strays"),
    realRepoArgv: [],
    needs: [],
  },
  // The shell leg is Python: it needs python3 (the TypeScript twin does not).
  {
    name: "check-markdown-links",
    group: "repo-scans",
    suite: suite("markdown-links"),
    realRepoArgv: [],
    needs: ["python3"],
  },
  // version-checks (PB)
  {
    name: "check-skill-versions",
    group: "version-checks",
    suite: suite("skill-versions"),
    ...BASE,
    needs: [],
  },
  {
    name: "check-extension-version-bump",
    group: "version-checks",
    suite: suite("extension-version-bump"),
    ...BASE,
    needs: [],
  },
  {
    name: "check-extension-provenance",
    group: "version-checks",
    suite: suite("extension-provenance"),
    realRepoArgv: [],
    needs: ["jq", "yq"],
  },
  {
    name: "check-extension-pivot",
    group: "version-checks",
    suite: suite("extension-pivot"),
    realRepoArgv: [],
    needs: [],
  },
  // extension-hook-checks (PC)
  {
    name: "check-extension-manifest-version",
    group: "extension-hook-checks",
    suite: suite("extension-manifest-version"),
    realRepoArgv: [],
    needs: ["jq", "yq"],
  },
  // hook-map renders probes into mktemp -d (outside the repo): not mutating.
  {
    name: "check-extension-hook-map",
    group: "extension-hook-checks",
    suite: suite("extension-hook-map"),
    realRepoArgv: [],
    needs: ["jq"],
  },
  // hook-tokens runs `rm -rf extensions/*/*/dist-*-plugin` on the repository: mutating.
  {
    name: "check-extension-hook-tokens",
    group: "extension-hook-checks",
    suite: suite("extension-hook-tokens"),
    mutating: true,
    realRepoArgv: [],
    needs: ["jq"],
  },
  // metadata-routing-layout (PD)
  {
    name: "check-component-metadata-keys",
    group: "metadata-routing-layout",
    suite: suite("component-metadata-keys"),
    realRepoArgv: [],
    needs: ["yq"],
  },
  {
    name: "check-feedback-routing",
    group: "metadata-routing-layout",
    suite: suite("feedback-routing"),
    realRepoArgv: [],
    needs: ["yq"],
  },
  {
    name: "check-core-paths",
    group: "metadata-routing-layout",
    suite: suite("core-paths"),
    realRepoArgv: [],
    needsCommit: true,
    needs: [],
  },
  // The shell leg pipes the declaration printer through python3.
  {
    name: "check-gemini-overlay-enrollment",
    group: "metadata-routing-layout",
    suite: suite("gemini-overlay-enrollment"),
    realRepoArgv: [],
    needs: ["python3"],
  },
  {
    name: "check-claude-agent-layout",
    group: "metadata-routing-layout",
    suite: suite("claude-agent-layout"),
    realRepoArgv: [],
    needs: [],
  },
  // figure-labels (PE): both legs print SKIP without tesseract/python3, so the suite needs
  // nothing; PE's own test supplies a stand-in tesseract for the substantive comparison.
  {
    name: "check-figure-labels",
    group: "figure-labels",
    suite: suite("figure-labels"),
    realRepoArgv: [],
    needs: [],
  },
  // foundations (P0): agents-size has no Bash suite.
  { name: "check-agents-size", group: "foundations", suite: null, realRepoArgv: [], needs: [] },
];

export function casesOf(group: GovernanceGroup): readonly GovernanceCase[] {
  return GOVERNANCE_CASES.filter((c) => c.group === group);
}

/** Tools of `needs` that are absent from PATH on this host. */
export function missingTools(c: GovernanceCase, which: (t: string) => boolean): Tool[] {
  return c.needs.filter((t) => !which(t));
}

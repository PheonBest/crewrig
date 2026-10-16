// ext-version-bump-text.ts — the fixed message texts of the extension version-bump
// check (spec 0259), kept apart from the logic so the wording is reviewable alone.
//
// Usage: import the constants and builders in ext-version-bump.ts.
// Exit codes: not applicable (library). Finding-line format: see the builders.

export const NO_MODIFIED_PREFIX = "OK: no existing extension skill/agent sources modified vs ";

export const ALL_BUMPED = "OK: all changed extension skill/agent sources include a version bump.";

export function checkingLine(count: number): string {
  return `Checking version bumps on ${count} modified extension skill/agent source(s)...`;
}

export function newCarrierMissing(file: string): string {
  return `  FAIL ${file} — no (or empty) crewrig-provenance version on the working tree (every upstream extension component must carry one per spec 0043)`;
}

export function baseVersionEmpty(file: string): string {
  return `  FAIL ${file} — base carrier present but its version is empty/missing (corruption or masked no-bump; not exempt)`;
}

export function notBumped(file: string, version: string): string {
  return `  FAIL ${file} — version not bumped (still '${version}')`;
}

export function bumped(file: string, oldVersion: string, newVersion: string): string {
  return `  OK   ${file} (${oldVersion} → ${newVersion})`;
}

export function exemptNoBaseCarrier(file: string): string {
  return `  OK   ${file} — base had no provenance carrier; this modification adds one (exempt, pre-0043 component)`;
}

/** The failure summary, one entry per output line (blank entries are blank lines). */
export function failureSummary(failures: readonly string[]): string[] {
  return [
    "",
    `FAILED: ${failures.length} extension source(s) changed without a version bump:`,
    ...failures.map((f) => `  - ${f}`),
    "",
    "Per AGENTS.md → Version Bump Convention and artifacts/FORMAT.md, bump the",
    "crewrig-provenance carrier version (the FIRST BODY LINE HTML comment, NOT",
    "frontmatter) in the same diff. SemVer:",
    "  PATCH (1.0.0 → 1.0.1) — friction fix / wording change",
    "  MINOR (1.0.0 → 1.1.0) — additive (new section, new field)",
    "  MAJOR (1.0.0 → 2.0.0) — breaking contract change",
  ];
}

// log-parse.ts — read the engine log of a publish run (spec 0213 R14, spec 0257 R13) and the
// SemVer shape of a rehearsal version. Port of release_failed_step, release_created_tag and
// release_is_semver.

// Greedy leading `[\s\S]*` makes the LAST `Failed step` on the line win, as the shell's greedy
// `.*` did; `[\s\S]` stands for sed's `.`, which also matches a carriage return.
const FAILED_STEP = /^[\s\S]*Failed step "([^"]*)" of plugin "([^"]*)"[\s\S]*$/;
const CREATED_TAG = /^[\s\S]*Created tag ([^ ]*)/;
const SEMVER =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

/**
 * The step R14 names for a failed run. The core logs `Failed step "<type>" of plugin "<name>"`
 * for the failing plugin and the FIRST such line is the cause. The GitLab plugin's publish step
 * is split by its own error text, searched in the whole log.
 */
export function failedStep(log: string): string {
  const line = log.split("\n").find((l) => l.includes('Failed step "'));
  if (line === undefined) return "engine";
  // A line the substitution does not match stays whole, in both captures (sed leaves it as is).
  const match = FAILED_STEP.exec(line);
  const type = match?.[1] ?? line;
  const plugin = match?.[2] ?? line;
  const key = `${type}|${plugin}`;
  switch (key) {
    case "prepare|@semantic-release/exec":
      return "package";
    case "prepare|@semantic-release/git":
      return "commit";
    case "publish|@semantic-release/gitlab":
      if (log.includes("GitLab generics package API")) return "upload";
      if (log.includes("GitLab release API")) return "release";
      return "engine";
    case "publish|@semantic-release/github":
      return "release";
    default:
      return key.startsWith("verifyConditions|") ? "verify" : "engine";
  }
}

/**
 * The tag this engine run created, or "". The core logs `Created tag <tag>` once the tag exists
 * locally, after every prepare step succeeded and before it is pushed. Reading the run's own log,
 * rather than diffing `git tag -l`, keeps a remote tag the core merely FETCHED from being
 * reported as created.
 */
export function createdTag(log: string): string {
  for (const line of log.split("\n")) {
    const match = CREATED_TAG.exec(line);
    if (match !== null) return match[1] ?? "";
  }
  return "";
}

/** Strict SemVer 2.0.0 shape check, for the version the rehearsal passes as a literal. */
export function isSemver(version: string): boolean {
  return SEMVER.test(version);
}

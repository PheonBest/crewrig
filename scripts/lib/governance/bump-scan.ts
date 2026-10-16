// bump-scan.ts — list the modified (status M) files under a pathspec set, the
// working tree against a base (spec 0259; shared by the version-bump checks).
//
// Usage: modifiedFiles(base, pathspecs, cwd)
// Exit codes: not applicable (library). Finding-line format: not applicable.

import { runGit } from "./git-run.ts";

/**
 * `git diff --name-status BASE -- <pathspecs>` filtered to status exactly `M`
 * (added, deleted, renamed and copied entries are dropped). A git failure
 * yields an empty list, like the shell's `|| true`. Names keep git's own
 * quoting, as the shell consumed them.
 */
export function modifiedFiles(
  base: string,
  pathspecs: readonly string[],
  cwd: string = process.cwd(),
): string[] {
  const res = runGit(["diff", "--name-status", base, "--", ...pathspecs], { cwd });
  const files: string[] = [];
  for (const line of res.stdout.toString("utf8").split("\n")) {
    if (line === "") continue;
    const tab = line.indexOf("\t");
    if (tab === -1) continue;
    if (line.slice(0, tab) === "M") files.push(line.slice(tab + 1));
  }
  return files;
}

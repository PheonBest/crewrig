// mutation-copy.ts — the generic mutation helper of spec 0260 (requirements 6, 7
// and 12, decision record). A mutation case NEVER edits a tracked file in place: it
// copies the files that git tracks to a temporary directory, applies a text edit to
// the copy, and fails — never skips — when the text to mutate is absent or when the
// edit changes nothing. The Bash suites it replaces rewrote tracked files and
// restored them with `git checkout`; `node --test` runs files in parallel, so that
// mechanism would race.
//
// Suite-specific helpers (usage-mutants.ts, usage-dashboard-mutate.ts) are thin
// wrappers over `copyTracked` and `applyMutation`.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface MutationCopy {
  /** Root of the temporary copy. */
  readonly root: string;
  dispose(): void;
}

/** Files that git tracks under the given pathspecs of `repo`, as repo-relative paths. */
export function trackedFiles(repo: string, pathspecs: readonly string[]): string[] {
  const r = spawnSync("git", ["ls-files", "-z", "--", ...pathspecs], {
    cwd: repo,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) {
    throw new Error(`git ls-files failed in ${repo}: ${r.stderr}`);
  }
  return r.stdout.split("\0").filter((p) => p !== "");
}

/**
 * Copy the tracked files under `pathspecs` of `repo` into a fresh temporary directory
 * (only what git tracks: an untracked `node_modules` or `dist` of a developer's
 * checkout never leaks in). When `linkNodeModules` is set, the repository's
 * `node_modules` is linked into the copy (a junction on Windows).
 */
export function copyTracked(
  repo: string,
  pathspecs: readonly string[],
  options: { linkNodeModules?: boolean } = {},
): MutationCopy {
  const files = trackedFiles(repo, pathspecs);
  if (files.length === 0) {
    throw new Error(`mutation-copy: no tracked file under ${pathspecs.join(", ")} in ${repo}`);
  }
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-mutation-")));
  for (const rel of files) {
    const from = path.join(repo, rel);
    const to = path.join(root, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
  if (options.linkNodeModules === true) {
    const modules = path.join(repo, "node_modules");
    if (fs.existsSync(modules)) {
      fs.symlinkSync(modules, path.join(root, "node_modules"), "junction");
    }
  }
  return {
    root,
    dispose() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

/**
 * Replace `needle` (a string or a RegExp) by `replacement` in `rel` of the copy.
 * Line endings are normalised to LF before the edit so that a CRLF checkout cannot
 * hide the needle. Throws, naming the file and the text, when the needle is absent
 * or when the edit leaves the file unchanged.
 */
export function applyMutation(
  copy: MutationCopy,
  rel: string,
  needle: string | RegExp,
  replacement: string,
): void {
  const file = path.join(copy.root, rel);
  const before = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const present = typeof needle === "string" ? before.includes(needle) : needle.test(before);
  if (!present) {
    throw new Error(`mutation needle absent in ${rel}: ${String(needle)}`);
  }
  const after =
    typeof needle === "string" ? before.replace(needle, () => replacement) : before.replace(needle, replacement);
  if (after === before) {
    throw new Error(`mutation changed nothing in ${rel}: ${String(needle)}`);
  }
  fs.writeFileSync(file, after);
}

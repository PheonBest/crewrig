// ext-pivot.ts — logic of check-extension-pivot (spec 0259, twin of
// scripts/check-extension-pivot.sh). Paths are cwd-relative, as in the shell.
//
// Usage: const { lines, code } = checkPivot();
// Reuses nothing from walk.ts for directories (it lists files only); command
// files are found with `findFiles`. `find -path` semantics: `*` also matches `/`,
// so the commands glob matches at any depth and the agents glob minus its
// deeper-level exclusion selects directories with no `/` after any `/agents/`.
// Exit codes: 0 when every component is pivot-authored, 1 otherwise.
// Finding-line format: `  FAIL <path> — <reason>` on stdout.

import { lstatSync, readdirSync, statSync } from "node:fs";
import { findFiles } from "./walk.ts";

const TIER_ROOTS = ["extensions/core", "extensions/library"];

export interface PivotResult {
  lines: string[];
  code: number;
}

const byteOrder = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** `find <root>` does not descend into a root that is itself a symlink. */
function traversable(root: string): boolean {
  return !lstatSync(root).isSymbolicLink();
}

/** Every real directory below `root` (symlinks excluded), as `root/...` paths. */
function listDirs(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = `${dir}/${name}`;
      if (lstatSync(p).isDirectory()) {
        out.push(p);
        visit(p);
      }
    }
  };
  visit(root);
  return out;
}

// The twin of `find -type d` with a `-path` glob on agents/ and a `-not -path` glob for deeper levels.
function agentDirs(root: string): string[] {
  return listDirs(root)
    .filter((p) => p.includes("/agents/") && !/\/agents\/[\s\S]*\//.test(p))
    .sort(byteOrder);
}

function commandToml(root: string): string[] {
  return findFiles(root, (rel) => /\/commands\/[\s\S]*\.toml$/.test(`${root}/${rel}`)).map(
    (rel) => `${root}/${rel}`,
  );
}

export function checkPivot(): PivotResult {
  const lines: string[] = [];
  const failures: string[] = [];
  let commands = 0;
  let agents = 0;

  for (const root of TIER_ROOTS) {
    if (!isDir(root)) continue;
    if (!traversable(root)) continue;

    for (const toml of commandToml(root)) {
      commands++;
      const slash = toml.lastIndexOf("/");
      const dir = toml.slice(0, slash);
      const base = toml.slice(slash + 1);
      // basename NAME .toml leaves the name alone when the suffix is the whole name.
      const stem = base === ".toml" ? base : base.slice(0, -".toml".length);
      if (!isFile(`${dir}/${stem}.md`)) {
        lines.push(
          `  FAIL ${toml} — generated Gemini .toml has no pivot sibling commands/${stem}.md (authored-native command)`,
        );
        failures.push(toml);
      } else {
        lines.push(`  OK   ${toml} (pivot sibling present)`);
      }
    }

    for (const dir of agentDirs(root)) {
      agents++;
      if (!isFile(`${dir}/AGENT.md`)) {
        lines.push(`  FAIL ${dir} — agent directory lacks the pivot source AGENT.md`);
        failures.push(dir);
      } else {
        lines.push(`  OK   ${dir} (AGENT.md present)`);
      }
    }
  }

  if (failures.length > 0) {
    lines.push(
      "",
      `FAILED: ${failures.length} extension component(s) are authored CLI-native instead of pivot:`,
      ...failures.map((f) => `  - ${f}`),
      "",
      "Per spec 0042 R1/R7, every skill, agent, and command under an upstream-owned",
      "extension tier (extensions/core, extensions/library) MUST be authored in the",
      "pivot source format:",
      "  - command → commands/<name>.md  (the .toml is a GENERATED Gemini output",
      "    under the render-at-publication model — spec 0173 delta-01 — and MUST",
      "    NOT be committed; delete it and reach it through one of the delivery",
      "    paths in extension-skeleton/EXTENSION-FORMAT.md instead)",
      "  - agent   → agents/<name>/AGENT.md",
      "  - skill   → skills/<name>/SKILL.md",
    );
    return { lines, code: 1 };
  }
  lines.push(
    "",
    `OK: every upstream-owned extension component is pivot-authored (${commands} command .toml, ${agents} agent dir checked).`,
  );
  return { lines, code: 0 };
}

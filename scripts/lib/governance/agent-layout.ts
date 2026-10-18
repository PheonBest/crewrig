// agent-layout.ts — flat `.claude/agents` layout logic (spec 0259; replaces the logic of
// scripts/check-claude-agent-layout.ts, spec 0201 requirements 6-7).
//
// Usage: checkLayout(repoDir, io) -> exit code
// Inspects the WORKING TREE (not git). An entry directly inside `.claude/agents` is legal iff it
// is a regular file (lstat, never a symlink) whose name ends in `.md`; everything else is an
// offender, and a real directory also names every file or symlink beneath it. Paths are sorted
// by UTF-16 code unit over the whole path (`find | sort` under LC_ALL=C).
// Exit codes: 0 absent, empty or flat `*.md` only; 1 offenders (listed on stderr).
// Finding-line format: `  - .claude/agents/<path>` under a `FAILED:` heading, on stderr.
// `find` semantics kept: a `.claude/agents` that is itself a symlink is not descended into;
// an unreadable directory is skipped silently.

import { lstatSync, readdirSync, statSync } from "node:fs";

export interface Io {
  out(line: string): void;
  err(line: string): void;
}

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function names(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** `[ -d p ]`: follows symlinks. */
function followsToDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** `find dir -mindepth 1 ( -type f -o -type l )`: files and symlinks, symlinks not followed. */
function nestedFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of names(dir)) {
    const p = `${dir}/${name}`;
    const st = lstatSync(p);
    if (st.isDirectory()) out.push(...nestedFiles(p));
    else if (st.isFile() || st.isSymbolicLink()) out.push(p);
  }
  return out;
}

export function checkLayout(repoDir: string, io: Io): number {
  const agentsDir = `${repoDir}/.claude/agents`;
  if (!followsToDirectory(agentsDir)) {
    io.out(`OK: ${agentsDir} is absent — nothing to check.`);
    return 0;
  }

  const strip = (p: string): string =>
    p.startsWith(`${repoDir}/`) ? p.slice(repoDir.length + 1) : p;
  const topLevel = lstatSync(agentsDir).isSymbolicLink() ? [] : names(agentsDir);
  const offenders: string[] = [];
  for (const entry of topLevel.map((n) => `${agentsDir}/${n}`).sort(byCodeUnit)) {
    const st = lstatSync(entry);
    const legal = entry.endsWith(".md") && st.isFile();
    if (legal) continue;
    offenders.push(strip(entry));
    if (st.isDirectory()) offenders.push(...nestedFiles(entry).sort(byCodeUnit).map(strip));
  }

  if (offenders.length > 0) {
    io.err("");
    io.err(`FAILED: ${offenders.length} offending entr(y/ies) under .claude/agents:`);
    for (const p of offenders) io.err(`  - ${p}`);
    io.err("");
    io.err("The compiled Claude Code agent tree must hold only regular files named");
    io.err("<name>.md directly inside .claude/agents/ (spec 0201 requirements 1-2, 6).");
    return 1;
  }
  io.out("OK: .claude/agents/ holds only flat *.md files.");
  return 0;
}

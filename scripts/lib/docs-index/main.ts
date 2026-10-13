// main.ts — the order of operations and the exit codes of build-docs-index (the body of
// the former build-docs-index.sh, now a forwarding shim): 0 on success or no drift, 1 on a lint failure or drift, 2 on a usage
// error or a missing docs directory. Nothing here exits the process: the entry sets the code.
//
//   build-docs-index            regenerate docs/index.json
//   build-docs-index --check    compare the regenerated text with the committed manifest

import fs from "node:fs";

import type { Io } from "../extension/types.ts";
import { isFile, isStale, lineDiff, orphanErrors } from "./check.ts";
import { lintPage } from "./lint.ts";
import { renderIndex } from "./render.ts";
import { listPages } from "./walk.ts";

export interface MainInput {
  readonly argv: readonly string[];
  readonly repoRoot: string;
  readonly io: Io;
}

function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/** The page text; a page that cannot be read has no block, as awk's silenced error left it. */
function readPage(file: string): string {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

export async function main(input: MainInput): Promise<number> {
  const { io, repoRoot } = input;
  const docsDir = `${repoRoot}/docs`;
  const indexFile = `${repoRoot}/docs/index.json`;

  if (!isDirectory(docsDir)) {
    io.err(`Error: docs directory not found at ${docsDir}`);
    return 2;
  }

  // Only the first argument counts and an empty one means "write", as `${1:-}` did.
  const arg = input.argv[0] ?? "";
  if (arg !== "" && arg !== "--check") {
    io.err("Usage: build-docs-index [--check]");
    return 2;
  }
  const check = arg === "--check";

  const rows: string[] = [];
  const lintErrors: string[] = [];
  for (const rel of listPages(repoRoot)) {
    const page = lintPage(rel, readPage(`${repoRoot}/${rel}`));
    lintErrors.push(...page.errors);
    if (page.row !== undefined) rows.push(page.row);
  }
  if (isFile(indexFile))
    lintErrors.push(...orphanErrors(repoRoot, fs.readFileSync(indexFile, "utf8")));

  if (lintErrors.length > 0) {
    io.err("Documentation publication contract violations:");
    for (const message of lintErrors) io.err(`  - ${message}`);
    return 1;
  }

  const generated = renderIndex(rows);

  if (check) {
    if (!isFile(indexFile)) {
      io.err("Drift: docs/index.json is missing. Run: bash scripts/build-docs-index.sh");
      return 1;
    }
    const committed = fs.readFileSync(indexFile);
    if (isStale(committed, generated)) {
      io.err("Drift: docs/index.json is stale. Re-run: bash scripts/build-docs-index.sh");
      for (const line of lineDiff(committed.toString("utf8"), generated)) io.err(line);
      return 1;
    }
    io.out(`OK: docs/index.json is up to date (${rows.length} published pages).`);
    return 0;
  }

  // Not writeTextLf, and written in place rather than through a temporary file: a lone CR inside a
  // title is kept byte for byte and the file keeps its mode, as the shell's redirect did.
  fs.writeFileSync(indexFile, generated);
  io.out(`Wrote docs/index.json (${rows.length} published pages).`);
  return 0;
}

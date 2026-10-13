// docs-index-differential.test.ts — run the real scripts/build-docs-index.sh under LC_ALL=C and the
// TypeScript main() on identical trees, and require the same docs/index.json bytes, standard output,
// exit status and (for lint failures) standard error (spec 0257 R5-R8). Skipped without `bash`.
//
// Known, accepted differences (compared loosely below): the usage line names the entry the shell was
// started as, and `--check` drift prints a `diff -u` listing in the shell against bare `-`/`+` lines.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { main } from "../lib/docs-index/main.ts";
import { differentialCases, docsRoot, memoryIo } from "./lib/docs-index-trees.ts";
import type { DifferentialCase } from "./lib/docs-index-trees.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const SHELL = path.join(REPO, "scripts", "build-docs-index.sh");
const HAS_BASH = spawnSync("bash", ["-c", "exit 0"]).status === 0;

interface Observed {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

function runShell(root: string, args: readonly string[]): Observed {
  const env: NodeJS.ProcessEnv = { ...process.env, LC_ALL: "C" };
  delete env["NODE_TEST_CONTEXT"];
  delete env["CI"];
  const res = spawnSync("bash", [path.join(root, "scripts", "build-docs-index.sh"), ...args], {
    cwd: root,
    env,
    encoding: "utf8",
  });
  return { status: res.status ?? -1, stdout: res.stdout, stderr: res.stderr };
}

async function runTs(root: string, args: readonly string[]): Promise<Observed> {
  const { io, out, err } = memoryIo();
  const status = await main({ argv: args, repoRoot: root, io });
  const lines = (list: string[]): string => list.map((line) => `${line}\n`).join("");
  return { status, stdout: lines(out), stderr: lines(err) };
}

/** Stderr as compared: lint output is exact, usage and drift are reduced to their first line. */
function comparableStderr(text: string, root: string): string {
  const shown = text.replaceAll(root, "<ROOT>");
  if (shown.startsWith("Usage:")) return "Usage:";
  if (shown.startsWith("Drift:")) return shown.split("\n")[0] ?? "";
  return shown;
}

function indexBytes(root: string): Buffer | undefined {
  const file = path.join(root, "docs", "index.json");
  return fs.existsSync(file) ? fs.readFileSync(file) : undefined;
}

async function compare(testCase: DifferentialCase): Promise<void> {
  const shellRoot = docsRoot(testCase.files);
  const tsRoot = docsRoot(testCase.files);
  fs.mkdirSync(path.join(shellRoot, "scripts"), { recursive: true });
  fs.copyFileSync(SHELL, path.join(shellRoot, "scripts", "build-docs-index.sh"));

  for (const args of testCase.steps) {
    const label = `${testCase.name} [${args.join(" ")}]`;
    const shell = runShell(shellRoot, args);
    const ts = await runTs(tsRoot, args);
    assert.equal(ts.status, shell.status, `${label}: exit status`);
    assert.equal(ts.stdout, shell.stdout, `${label}: stdout`);
    assert.equal(
      comparableStderr(ts.stderr, tsRoot),
      comparableStderr(shell.stderr, shellRoot),
      `${label}: stderr`,
    );
    assert.deepEqual(indexBytes(tsRoot), indexBytes(shellRoot), `${label}: docs/index.json`);
  }
}

describe("build-docs-index: shell and TypeScript agree", { skip: !HAS_BASH }, () => {
  for (const testCase of differentialCases) {
    test(testCase.name, () => compare(testCase));
  }
});

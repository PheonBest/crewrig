// governance-sandbox.ts — the sandbox of the governance differential harness (spec 0259 R26,
// PLAN v2 section 1). The sandbox is built from what GIT TRACKS (git ls-files), never from a
// directory walk, so an untracked node_modules or dist cannot leak in. It gets its own `.git`
// (git init in the copy), the root package.json, and REAL copies (never symlinks: the loader
// refuses them) of node_modules/js-yaml and node_modules/argparse.
//
// installTee keeps the shell original at scripts/<name>.sh.shell (same bytes, same directory,
// so BASH_SOURCE-relative lib lookups still work) and writes at scripts/<name>.sh a bash stub
// that runs governance-tee.ts, which compares the shell and the TypeScript legs.

import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { REPO } from "./build-fixture-tree.ts";

/** The runtime dependencies the TypeScript entries load (real directories, dereferenced). */
const DEPS: readonly string[] = ["js-yaml", "argparse"];
/** The comparison wrapper, relative to a sandbox root. */
export const TEE_PATH = "scripts/tests/lib/governance-tee.ts";
const NODE_FLAG = "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON";

/** A row of a differential case table, as the tee understands it. */
export interface TeeCase {
  /** Check name: `scripts/<name>.sh` and `scripts/<name>.ts`. */
  readonly name: string;
  /** The check writes files: leg (b) runs in a pre-run copy and the file trees are compared. */
  readonly mutating?: boolean;
  /** Only the exit status is compared (shell fails through its own runtime, deviation (d)). */
  readonly statusOnly?: boolean;
}

export interface Sandbox {
  readonly root: string;
  /** Child environment: process.env without CI and NODE_TEST_CONTEXT (unset, not empty). */
  readonly env: NodeJS.ProcessEnv;
  dispose(): void;
}

export interface SandboxOptions {
  /** Repository to copy the tracked files of (default: this checkout). */
  readonly repo?: string;
  /** Skip the tracked-file copy: only package.json, deps and `copyFromRepo` (self-tests). */
  readonly minimal?: boolean;
  /** Working-tree files of `repo` copied even in minimal mode (e.g. the tee itself). */
  readonly copyFromRepo?: readonly string[];
  /** Extra files written into the sandbox, relative path -> content. */
  readonly files?: Readonly<Record<string, string>>;
}

/** process.env minus CI and NODE_TEST_CONTEXT, which change reporter and test behaviour. */
export function cleanEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  delete env["CI"];
  delete env["NODE_TEST_CONTEXT"];
  return env;
}

function git(cwd: string, args: readonly string[]): Buffer {
  const r = spawnSync("git", args, { cwd, encoding: "buffer" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr.toString()}`);
  return r.stdout;
}

function copyFile(repo: string, root: string, rel: string): void {
  const src = path.join(repo, rel);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(src); // follows symlinks: the copy is always a real file
  } catch {
    return; // tracked but deleted in the working tree
  }
  if (!stat.isFile()) return; // submodule or directory entry
  const dest = path.join(root, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(fs.realpathSync(src), dest);
  fs.chmodSync(dest, stat.mode & 0o777);
}

/** Build a sandbox from the git-tracked files (`git ls-files`) of the repository. */
export function makeSandbox(options: SandboxOptions = {}): Sandbox {
  const repo = options.repo ?? REPO;
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gov-sandbox-")));
  const tracked =
    options.minimal === true
      ? ["package.json", ...(options.copyFromRepo ?? [])]
      : git(repo, ["ls-files", "-z"])
          .toString()
          .split("\0")
          .filter((rel) => rel !== "");
  for (const rel of tracked) copyFile(repo, root, rel);
  for (const dep of DEPS) {
    const src = path.join(repo, "node_modules", dep);
    fs.cpSync(src, path.join(root, "node_modules", dep), { recursive: true, dereference: true });
  }
  for (const [rel, content] of Object.entries(options.files ?? {})) {
    const dest = path.join(root, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
  }
  git(root, ["init", "-q"]);
  return {
    root,
    env: cleanEnv(),
    dispose: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

/**
 * Put the comparison tee in front of `scripts/<name>.sh`. The shell original moves, byte for
 * byte, to `scripts/<name>.sh.shell`; the stub created in its place is runtime-only.
 * The case flags travel to the tee in GOVERNANCE_TEE_MUTATING / GOVERNANCE_TEE_STATUS_ONLY.
 */
export function installTee(
  sandbox: Sandbox,
  scriptName: string,
  flags: Omit<TeeCase, "name"> = {},
): void {
  const sh = path.join(sandbox.root, "scripts", `${scriptName}.sh`);
  const original = fs.readFileSync(sh);
  const mode = fs.statSync(sh).mode & 0o777;
  fs.writeFileSync(`${sh}.shell`, original, { mode });
  const tee = path.join(sandbox.root, TEE_PATH);
  const lines = ["#!/usr/bin/env bash"];
  if (flags.mutating === true) lines.push("export GOVERNANCE_TEE_MUTATING=1");
  if (flags.statusOnly === true) lines.push("export GOVERNANCE_TEE_STATUS_ONLY=1");
  lines.push(`exec node ${NODE_FLAG} '${tee}' '${scriptName}' "$@"`, "");
  fs.writeFileSync(sh, lines.join("\n"), { mode: 0o755 });
}

export interface RunOptions {
  readonly args?: readonly string[];
  readonly input?: string;
  /** Working directory relative to the sandbox root (default: the root). */
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
}

/** Run `bash scripts/<name>.sh` (the tee stub once installTee ran) inside the sandbox. */
export function runScript(
  sandbox: Sandbox,
  name: string,
  o: RunOptions = {},
): SpawnSyncReturns<string> {
  return spawnSync("bash", [path.join(sandbox.root, "scripts", `${name}.sh`), ...(o.args ?? [])], {
    cwd: path.join(sandbox.root, o.cwd ?? "."),
    env: { ...sandbox.env, ...o.env },
    input: o.input ?? "",
    encoding: "utf8",
  });
}

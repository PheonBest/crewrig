// release-rehearsal-diff.ts — the real-repository rehearsal of the two release drivers (spec 0257
// R26, plan channel 4): `RELEASE_DRY_RUN=true bash scripts/monorepo-release.sh`, then the same with
// `node scripts/monorepo-release.ts`, on the same named branch and without any credential, and the
// requirement that both print the same thing, exit the same way and leave the checkout as found.
// It needs the engine, the network, a full-depth checkout with tags and the development
// dependencies, so a CI job runs it; the unit test covers only the pure parts.
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/tests/lib/release-rehearsal-diff.ts [--repo <dir>]

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isCredentialName } from "../../lib/monorepo-release/credentials.ts";
import { git as realGit } from "../../lib/sync-from-upstream/git.ts";
import type { GitResult } from "../../lib/sync-from-upstream/git.ts";

export interface Leg {
  readonly stdout: string;
  readonly stderr: string;
  readonly status: number;
}

export interface NormaliseContext {
  /** Temporary-directory roots the scratch directories live under (`os.tmpdir()` and its real path). */
  readonly tmpDirs: readonly string[];
}

export type GitFn = (args: readonly string[]) => GitResult;

const SCRATCH = "<SCRATCH>";

/**
 * Hides what legitimately differs between two runs: digests, the hash inside an archive name and
 * the scratch directory (`mktemp -d` in the shell, `crewrig-release-XXXX` in the port).
 */
export function normalise(text: string, ctx: NormaliseContext): string {
  let out = text.replace(/sha256=[0-9a-fA-F]{8,}/g, "sha256=<SHA256>");
  out = out.replace(/(archive=\S*?)[0-9a-f]{7,64}(?=[.\-_\s]|$)/gm, "$1<HEX>");
  const roots = [...ctx.tmpDirs].filter((d) => d !== "").sort((a, b) => b.length - a.length);
  for (const root of roots) {
    const prefix = root.replace(/\/+$/, "");
    out = out.split(`${prefix}/`).join("/tmp/");
  }
  out = out.replace(/\/var\/folders\/[^/\s'"]+\/[^/\s'"]+\/T\//g, "/tmp/");
  // `/tmp/<scratch>` (any name) collapses to one token; the rest of the path stays comparable.
  return out.replace(/\/tmp\/[^/\s'":]+/g, SCRATCH);
}

function firstDifference(a: string, b: string): string {
  const left = a.split("\n");
  const right = b.split("\n");
  const count = Math.max(left.length, right.length);
  for (let i = 0; i < count; i++) {
    if (left[i] !== right[i]) {
      const l = left[i] === undefined ? "<end of output>" : left[i];
      const r = right[i] === undefined ? "<end of output>" : right[i];
      return `line ${i + 1}:\n--- shell\n+++ typescript\n-${l}\n+${r}`;
    }
  }
  return "";
}

/** Pure: the two legs are compared as given (normalise them first). */
export function compareRehearsals(shell: Leg, ts: Leg): { equal: boolean; report: string } {
  const parts: string[] = [];
  if (shell.status !== ts.status) {
    parts.push(`exit status differs: shell=${shell.status} typescript=${ts.status}`);
  }
  for (const stream of ["stdout", "stderr"] as const) {
    const diff = firstDifference(shell[stream], ts[stream]);
    if (diff !== "") parts.push(`${stream} differs at ${diff}`);
  }
  return { equal: parts.length === 0, report: parts.join("\n") };
}

/** The named branch both legs run on; `restore` puts the detached HEAD back (no-op when it was named). */
export function ensureNamedBranch(git: GitFn): { restore: () => void } {
  const head = git(["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim();
  if (head !== "HEAD") return { restore: () => undefined };
  const sha = git(["rev-parse", "HEAD"]).stdout.trim();
  const switched = git(["switch", "-C", "rehearsal-diff"]);
  if (switched.status !== 0) throw new Error(`cannot create rehearsal-diff: ${switched.stderr}`);
  return {
    restore: () => {
      git(["switch", "--detach", sha]);
      git(["branch", "-D", "rehearsal-diff"]);
    },
  };
}

/** Every symbolic link under `dir` (not followed), as paths relative to it. */
export function findSymlinks(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) found.push(path.relative(dir, full));
      else if (entry.isDirectory()) walk(full);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return found.sort();
}

/** Symbolic links under every `build/extensions/*` tree of `repo` (spec R11). */
export function extensionSymlinks(repo: string): string[] {
  const base = path.join(repo, "build", "extensions");
  if (!fs.existsSync(base)) return [];
  return fs
    .readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .flatMap((e) => findSymlinks(path.join(base, e.name)).map((l) => `${e.name}/${l}`));
}

/** What a rehearsal must leave untouched: the working tree state (ignored files too) and the refs. */
export function checkoutState(git: GitFn): string {
  const status = git(["status", "--porcelain", "--ignored"]).stdout;
  const refs = git(["for-each-ref"]).stdout;
  return `${status}\n--refs--\n${refs}`;
}

/** `owner/name` from an origin URL (https or scp-like), or undefined. */
export function repositoryFromRemote(url: string): string | undefined {
  const match = /[:/]([^/:]+\/[^/:]+?)(?:\.git)?\/?$/.exec(url.trim());
  return match?.[1];
}

/** The child environment: no credential-named variable, no `CI`, a fixed GitHub-flavoured shape. */
export function legEnvironment(
  base: NodeJS.ProcessEnv,
  repository: string,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(base)) {
    if (value === undefined || isCredentialName(name)) continue;
    if (name === "CI" || name === "NODE_TEST_CONTEXT" || name === "GITLAB_CI") continue;
    if (name.startsWith("RELEASE_") || name.startsWith("CI_")) continue;
    env[name] = value;
  }
  return {
    ...env,
    GITHUB_ACTIONS: "true",
    GITHUB_SERVER_URL: "https://github.com",
    GITHUB_REPOSITORY: repository,
    RELEASE_DRY_RUN: "true",
  };
}

function runLeg(repo: string, argv: readonly string[], env: Record<string, string>): Leg {
  const run = spawnSync(argv[0] ?? "", argv.slice(1), {
    cwd: repo,
    env,
    encoding: "utf8",
    maxBuffer: 1 << 28,
    timeout: 20 * 60 * 1000,
  });
  return { stdout: run.stdout, stderr: run.stderr, status: run.status ?? 127 };
}

function parseRepo(argv: readonly string[]): string {
  const at = argv.indexOf("--repo");
  const value = at === -1 ? undefined : argv[at + 1];
  return path.resolve(value ?? process.cwd());
}

export function main(argv: readonly string[]): number {
  const repo = parseRepo(argv);
  const git: GitFn = (args) => realGit(args, { cwd: repo });
  const remote = git(["remote", "get-url", "origin"]).stdout;
  const repository = process.env["GITHUB_REPOSITORY"] ?? repositoryFromRemote(remote);
  if (repository === undefined) {
    process.stderr.write("Error: no GITHUB_REPOSITORY and no parsable origin URL\n");
    return 2;
  }
  const env = legEnvironment(process.env, repository);
  const ctx: NormaliseContext = { tmpDirs: [os.tmpdir(), fs.realpathSync(os.tmpdir()), "/tmp"] };
  const branch = ensureNamedBranch(git);
  const legs: Record<string, Leg> = {};
  const problems: string[] = [];
  try {
    const commands = {
      shell: ["bash", "scripts/monorepo-release.sh"],
      typescript: [process.execPath, "scripts/monorepo-release.ts"],
    };
    for (const [name, argv] of Object.entries(commands)) {
      const before = checkoutState(git);
      const leg = runLeg(repo, argv, env);
      legs[name] = {
        stdout: normalise(leg.stdout, ctx),
        stderr: normalise(leg.stderr, ctx),
        status: leg.status,
      };
      if (checkoutState(git) !== before) {
        problems.push(`the ${name} leg changed the checkout (git status --ignored or the refs)`);
      }
      for (const link of extensionSymlinks(repo)) {
        problems.push(`the ${name} leg left a symbolic link: build/extensions/${link}`);
      }
    }
  } finally {
    branch.restore();
  }
  const shell = legs["shell"];
  const ts = legs["typescript"];
  if (shell === undefined || ts === undefined) return 2;
  const verdict = compareRehearsals(shell, ts);
  if (!verdict.equal) problems.push(verdict.report);
  if (problems.length > 0) {
    process.stdout.write(`rehearsal comparison FAILED\n${problems.join("\n")}\n`);
    return 1;
  }
  const lines = shell.stdout.split("\n").length;
  process.stdout.write(
    `rehearsal comparison OK: both drivers exit ${shell.status}, ${lines} identical stdout lines\n`,
  );
  return 0;
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = main(process.argv.slice(2));
}

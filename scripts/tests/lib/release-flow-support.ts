// release-flow-support.ts — shared pieces of the release driver flow suites (spec 0257 R22): the
// CI variable blocks of the two forges, a forge stub running as a CHILD process (the sandbox runs
// the driver with spawnSync, which would starve an in-process server), and small readers.

import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { REPO } from "./build-fixture-tree.ts";
import type { ReleaseSandbox } from "./release-driver-sandbox.ts";

const FORGE_STUB = path.join(REPO, "scripts", "tests", "fixtures", "release", "forge-stub.mjs");

export const GITHUB_PUBLISH = {
  GITHUB_ACTIONS: "true",
  GITHUB_EVENT_NAME: "push",
  GITHUB_REF: "refs/heads/main",
  GITHUB_REPOSITORY: "acme/fixture",
  GITHUB_SERVER_URL: "https://github.com",
  GITHUB_TOKEN: "sentinel-ghs-7f3a",
} as const;

export const GITLAB_PUBLISH = {
  GITLAB_CI: "true",
  CI_COMMIT_BRANCH: "main",
  CI_PIPELINE_SOURCE: "push",
  CI_PROJECT_ID: "7",
  CI_SERVER_URL: "https://gitlab.example.test:8443",
  CI_PROJECT_URL: "https://gitlab.example.test:8443/acme/fixture",
  GITLAB_TOKEN: "sentinel-glpat-9c21",
} as const;

export interface ForgeStub {
  readonly apiUrl: string;
  /** The requests the stub logged, oldest first. */
  requests(): Record<string, unknown>[];
  stop(): void;
}

/** Start forge-stub.mjs on an ephemeral port and wait until it announces it. */
export async function startForgeStub(): Promise<ForgeStub> {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "forge-stub-")));
  const portFile = path.join(dir, "port");
  const logFile = path.join(dir, "log.jsonl");
  const child: ChildProcess = spawn(
    process.execPath,
    [FORGE_STUB, portFile, logFile, path.join(dir, "uploads")],
    { env: { PATH: process.env["PATH"] ?? "" }, stdio: "ignore" },
  );
  for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!fs.existsSync(portFile)) {
    child.kill();
    throw new Error("the forge stub did not start");
  }
  return {
    apiUrl: `http://127.0.0.1:${fs.readFileSync(portFile, "utf8")}`,
    requests() {
      if (!fs.existsSync(logFile)) return [];
      return fs
        .readFileSync(logFile, "utf8")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
    },
    stop() {
      child.kill();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** The `package.json` version of an extension of the sandbox checkout. */
export function manifestVersion(sb: ReleaseSandbox, ext: string): string {
  const file = path.join(sb.root, "extensions", "core", ext, "package.json");
  return (JSON.parse(fs.readFileSync(file, "utf8")) as { version: string }).version;
}

/** A file of the sandbox origin's branch, read through `git show`; null when absent. */
export function showFromOrigin(sb: ReleaseSandbox, ref: string, file: string): string | null {
  const res = spawnSync("git", ["--git-dir", sb.originBare, "show", `${ref}:${file}`], {
    encoding: "utf8",
    env: sb.env(),
  });
  return res.status === 0 ? res.stdout : null;
}

/** The refs of the sandbox origin whose name starts with `prefix`. */
export function originRefs(sb: ReleaseSandbox, prefix: string): string[] {
  const res = spawnSync(
    "git",
    ["--git-dir", sb.originBare, "for-each-ref", "--format=%(refname)", prefix],
    {
      encoding: "utf8",
      env: sb.env(),
    },
  );
  return res.stdout.split("\n").filter((line) => line !== "");
}

/** Commit a deletion in the sandbox checkout (staged paths only: the stub stays uncommitted). */
export function commitRemoval(sb: ReleaseSandbox, rel: string): void {
  const env = {
    ...sb.env(),
    GIT_AUTHOR_NAME: "Release Sandbox",
    GIT_AUTHOR_EMAIL: "sandbox@example.invalid",
    GIT_COMMITTER_NAME: "Release Sandbox",
    GIT_COMMITTER_EMAIL: "sandbox@example.invalid",
  };
  for (const args of [
    ["rm", "-q", rel],
    ["commit", "-q", "--no-verify", "-m", `Remove ${rel}`],
  ]) {
    const res = spawnSync("git", args, { cwd: sb.root, env, encoding: "utf8" });
    if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
  }
}

/** The plugin entry named `name` of an engine config, as parsed JSON (undefined when absent). */
export function pluginOf(config: unknown, name: string): Record<string, unknown> | undefined {
  const plugins = (config as { plugins?: unknown[] }).plugins ?? [];
  const found = plugins.find((p) => Array.isArray(p) && p[0] === name) as unknown[] | undefined;
  return found === undefined ? undefined : (found[1] as Record<string, unknown>);
}

// spawn-sync.ts — synchronous child processes for the release packager (spec 0257 R9, D1).
//
// Two helpers, one launch plan. `runInherit` starts the builder with the parent's streams;
// `runDiscard` starts `gemini extensions validate` with its output thrown away, as the shell's
// `>/dev/null 2>&1` did. On Windows a `.cmd` shim is started through the plan of
// worktree-claim/launch-windows.ts (PATH only, never the current directory), never through a shell
// that would read argument characters as syntax. Both return the exit status; 127 when the program
// cannot be started, 126 when the Windows plan refuses it.

import { spawnSync } from "node:child_process";
import os from "node:os";

import { findOnPath } from "../mempalace-python.ts";
import {
  defaultIsFile,
  planWindowsLaunch,
  resolveOnPath,
} from "../worktree-claim/launch-windows.ts";

export interface SpawnOptions {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
  /** Let a path argument hold spaces through a `.cmd` shim (`C:\Users\John Doe\...`). */
  readonly allowSpaces?: boolean;
}

type Launch = { file: string; args: readonly string[]; verbatim: boolean } | { status: number };

function plan(argv: readonly string[], opts: SpawnOptions): Launch {
  const name = argv[0] ?? "";
  if ((opts.platform ?? process.platform) !== "win32") {
    return { file: name, args: argv.slice(1), verbatim: false };
  }
  const windows = planWindowsLaunch(argv, {
    platform: "win32",
    env: opts.env,
    isFile: defaultIsFile,
    toplevel: opts.cwd,
    ...(opts.allowSpaces === true ? { allowSpaces: true } : {}),
  });
  if (windows.kind === "missing") return { status: 127 };
  if (windows.kind === "refused") return { status: 126 };
  return { file: windows.file, args: windows.args, verbatim: windows.verbatim };
}

function exitStatus(status: number | null, signal: NodeJS.Signals | null): number {
  if (status !== null) return status;
  const number = signal === null ? undefined : os.constants.signals[signal];
  return number === undefined ? 1 : 128 + number;
}

function run(argv: readonly string[], opts: SpawnOptions, stdio: "inherit" | "ignore"): number {
  const launch = plan(argv, opts);
  if ("status" in launch) return launch.status;
  const res = spawnSync(launch.file, [...launch.args], {
    cwd: opts.cwd,
    env: { ...opts.env },
    stdio,
    windowsVerbatimArguments: launch.verbatim,
    windowsHide: true,
  });
  if (res.error !== undefined) return 127;
  return exitStatus(res.status, res.signal);
}

/** Run `argv` (program first) with the parent's standard streams; returns its exit status. */
export function runInherit(argv: readonly string[], opts: SpawnOptions): number {
  return run(argv, opts, "inherit");
}

/** Run `argv` with every stream discarded; returns its exit status. */
export function runDiscard(argv: readonly string[], opts: SpawnOptions): number {
  return run(argv, opts, "ignore");
}

/**
 * `command -v name`: true when `name` resolves on the environment's `PATH`. On Windows it is the
 * very resolution `runDiscard` will use, so "present" never means "then refused to launch".
 */
export function onPath(
  name: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform === "win32") {
    return resolveOnPath(name, { platform, env, isFile: defaultIsFile }) !== undefined;
  }
  return findOnPath(name, { ...env }, { platform }) !== undefined;
}

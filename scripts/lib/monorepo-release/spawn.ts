// spawn.ts — the asynchronous child-process layer of the release driver (spec 0257 R14, R18, R19).
//
// The shell ran the engine as `npx ... 2>&1 | tee log`; here the engine is spawned with piped
// streams that are forwarded as they arrive, so a long release shows progress live and the log
// is still captured. No shell is ever involved: an argument is one argv element, never syntax.
//
// Every running child is registered, so a termination signal received by the driver can stop
// them all (`killAll`). On POSIX a child leads its own process group, so the grandchildren of
// `npx` (the engine, the packager) are stopped with it rather than orphaned. On Windows only the
// direct child is signalled; a `.cmd` shim runs under `cmd.exe`, whose own children Node.js has
// no handle for.

import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";

import { defaultIsFile, planWindowsLaunch } from "../worktree-claim/launch-windows.ts";

export interface SpawnOptions {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly platform?: NodeJS.Platform;
  /** Let a path-like argument hold spaces when it goes through a Windows `.cmd` shim. */
  readonly allowSpaces?: boolean;
}

interface Launch {
  readonly file: string;
  readonly args: readonly string[];
  readonly verbatim: boolean;
}

const running = new Set<ChildProcess>();

/** The program and arguments to start, or the refusal message (Windows `.cmd` plan only). */
function plan(argv: readonly string[], opts: SpawnOptions): Launch | { readonly error: string } {
  const platform = opts.platform ?? process.platform;
  const name = argv[0] ?? "";
  if (platform !== "win32") return { file: name, args: argv.slice(1), verbatim: false };
  const planned = planWindowsLaunch(argv, {
    platform,
    env: opts.env,
    toplevel: opts.cwd,
    isFile: defaultIsFile,
    ...(opts.allowSpaces === true ? { allowSpaces: true } : {}),
  });
  if (planned.kind === "missing") return { error: `Error: '${name}' was not found on PATH.` };
  if (planned.kind === "refused") return { error: `Error: ${planned.message}` };
  return { file: planned.file, args: planned.args, verbatim: planned.verbatim };
}

/** `128 + n` for a signalled child, as a POSIX shell reports it. */
function exitStatus(code: number | null, signal: NodeJS.Signals | null): number {
  if (code !== null) return code;
  const number = signal === null ? undefined : os.constants.signals[signal];
  return number === undefined ? 1 : 128 + number;
}

type Settled = { readonly status: number };

/**
 * Start `argv` with piped stdout and stderr, hand each chunk to the listeners as it arrives and
 * resolve once the streams are drained. Never rejects: a program that cannot start is 127.
 */
function run(
  argv: readonly string[],
  opts: SpawnOptions,
  onStdout: (chunk: string) => void,
  onStderr: (chunk: string) => void,
): Promise<Settled> {
  const launch = plan(argv, opts);
  if ("error" in launch) {
    onStderr(`${launch.error}\n`);
    return Promise.resolve({ status: 127 });
  }
  return new Promise((resolve) => {
    let settled = false;
    const settle = (status: number): void => {
      if (settled) return;
      settled = true;
      resolve({ status });
    };
    const posix = (opts.platform ?? process.platform) !== "win32";
    const child = spawn(launch.file, [...launch.args], {
      cwd: opts.cwd,
      env: { ...opts.env },
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      detached: posix,
      windowsVerbatimArguments: launch.verbatim,
    });
    running.add(child);
    child.stdout.setEncoding("utf8").on("data", onStdout);
    child.stderr.setEncoding("utf8").on("data", onStderr);
    child.once("error", (error: NodeJS.ErrnoException) => {
      running.delete(child);
      onStderr(`Error: cannot start '${argv[0] ?? ""}': ${error.message}\n`);
      settle(127);
    });
    // `close`, not `exit`: it fires after both streams ended, so no output is lost.
    child.once("close", (code, signal) => {
      running.delete(child);
      settle(exitStatus(code, signal));
    });
  });
}

/**
 * Run `argv`, forwarding stdout and stderr to `out` in arrival order (the shell's `2>&1 | tee`),
 * accumulating them and appending them to `logFile` when given.
 */
export async function spawnTee(
  argv: readonly string[],
  opts: SpawnOptions & { out: (chunk: string) => void; logFile?: string },
): Promise<{ status: number; output: string }> {
  let output = "";
  const sink = (chunk: string): void => {
    output += chunk;
    if (opts.logFile !== undefined) fs.appendFileSync(opts.logFile, chunk);
    opts.out(chunk);
  };
  const { status } = await run(argv, opts, sink, sink);
  return { status, output };
}

/** Run `argv`, returning its stdout; stderr goes to the callback as it arrives. */
export async function spawnCapture(
  argv: readonly string[],
  opts: SpawnOptions & { stderr: (chunk: string) => void },
): Promise<{ status: number; stdout: string }> {
  let stdout = "";
  const { status } = await run(
    argv,
    opts,
    (chunk) => {
      stdout += chunk;
    },
    opts.stderr,
  );
  return { status, stdout };
}

/**
 * Run `command` with the driver's own stdio and resolve to its exit status (`128 + n` when
 * signalled, 127 when it cannot start). An argv runs without a shell; a string is the one input
 * that asks for the platform shell (the exec plugin's own command line). The child is registered
 * like the piped ones, so a termination signal stops it before the scratch directory, which may be
 * its working directory, is removed.
 */
export function spawnInherit(
  command: string | readonly string[],
  opts: SpawnOptions,
): Promise<number> {
  const shell = typeof command === "string";
  const argv = shell ? [command] : command;
  const launch = shell ? { file: command, args: [], verbatim: false } : plan(argv, opts);
  if ("error" in launch) {
    process.stderr.write(`${launch.error}\n`);
    return Promise.resolve(127);
  }
  return new Promise((resolve) => {
    const posix = (opts.platform ?? process.platform) !== "win32";
    const child = spawn(launch.file, [...launch.args], {
      cwd: opts.cwd,
      env: { ...opts.env },
      stdio: "inherit",
      shell,
      detached: posix,
      windowsVerbatimArguments: launch.verbatim,
    });
    running.add(child);
    child.once("error", () => {
      running.delete(child);
      resolve(127);
    });
    child.once("close", (code, signal) => {
      running.delete(child);
      resolve(exitStatus(code, signal));
    });
  });
}

/** Terminate every running child (and, on POSIX, its process group). */
export function killAll(signal: NodeJS.Signals = "SIGTERM"): void {
  for (const child of running) {
    try {
      if (process.platform !== "win32" && child.pid !== undefined) {
        process.kill(-child.pid, signal);
      } else {
        child.kill(signal);
      }
    } catch {
      // Already gone between the check and the signal.
      try {
        child.kill(signal);
      } catch {
        // Nothing left to signal.
      }
    }
  }
}

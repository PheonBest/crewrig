// run.ts — the runtime trust-propagation wrapper (spec 0084 R7/R11; spec 0266 R3, slice 5b).
//
// The Node.js replacement of the retired scripts/lib/tls-exec.sh. `scripts/tls-exec.ts` is the entry
// that registered command lines name (`node <repo>/scripts/tls-exec.ts <command> [args...]`): it
// reads the per-user managed TLS file `~/.crewrig/tls-env.sh`, adds its variables to the command's
// environment and runs the command with inherited streams, exiting with the command's own status.
//
// Behaviour of the shell wrapper, kept:
//   - an absent managed file is silent and the wrapper is transparent;
//   - the command, its arguments and its streams pass through untouched;
//   - the exit status is the command's (127 when it is not found, 126 when it cannot be started).
// Differences, each decided by spec 0252 requirement 12 (the installed twin):
//   - the managed file is PARSED, never executed: a malformed or unreadable file yields one warning
//     on standard error naming the file and the first offending line, and the command still runs;
//   - a first argument `--end-nonzero-on-child-exit` is the flag of the installed twin (a child that
//     ends cleanly ends the wrapper non-zero); it is parsed before the first non-flag argument only;
//   - with no command it prints a usage line and exits 2 (the shell's `exec` with no argument
//     exited 0 and did nothing).

import { spawn } from "node:child_process";
import os from "node:os";
import { superviseChild } from "../service/launcher/launcher-child.ts";
import type { ChildLike, StopSignal } from "../service/launcher/launcher-child.ts";
import { readTlsEnv } from "../tls-env.ts";

export const FLAG = "--end-nonzero-on-child-exit";

export interface ParsedArgs {
  readonly flagged: boolean;
  readonly command: readonly string[];
}

/** The flag is recognised in first position only; everything after belongs to the command. */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const flagged = argv[0] === FLAG;
  return { flagged, command: flagged ? argv.slice(1) : argv };
}

export interface TrustEnv {
  /** The environment the command runs with. */
  readonly env: Record<string, string | undefined>;
  /** The standard-error line to print, or `undefined` when the file was absent or applied. */
  readonly warning?: string;
}

/** The base environment plus the managed file's variables (read from `<home>/.crewrig/tls-env.sh`). */
export function trustEnv(home: string, base: NodeJS.ProcessEnv): TrustEnv {
  const env: Record<string, string | undefined> = { ...base };
  const trust = readTlsEnv(home);
  if (trust.kind === "ok") {
    Object.assign(env, trust.vars);
    return { env };
  }
  if (trust.kind === "malformed") {
    return {
      env,
      warning: `tls-exec: ignoring ${trust.file}: line ${trust.line} is outside the managed format`,
    };
  }
  if (trust.kind === "unreadable") {
    return { env, warning: `tls-exec: ignoring ${trust.file}: the file could not be read` };
  }
  return { env };
}

export interface RunDeps {
  readonly home: string;
  readonly baseEnv: NodeJS.ProcessEnv;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly exit: (code: number) => void;
  readonly spawnChild: (
    program: string,
    args: readonly string[],
    env: NodeJS.ProcessEnv,
  ) => ChildLike;
  readonly onSignal: (signal: StopSignal, handler: () => void) => void;
}

export const processDeps: RunDeps = {
  home: os.homedir(),
  baseEnv: process.env,
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  exit: (code) => process.exit(code),
  spawnChild: (program, args, env) =>
    spawn(program, [...args], { stdio: "inherit", env, windowsHide: true }),
  onSignal: (signal, handler) => process.on(signal, handler),
};

/** Run the wrapper over `argv` (the arguments after the script). */
export function runTlsExec(argv: readonly string[], deps: RunDeps = processDeps): void {
  const { flagged, command } = parseArgs(argv);
  const program = command[0];
  if (program === undefined) {
    deps.stderr(`usage: tls-exec.ts [${FLAG}] <command> [args...]\n`);
    deps.exit(2);
    return;
  }
  const trust = trustEnv(deps.home, deps.baseEnv);
  if (trust.warning !== undefined) deps.stderr(`${trust.warning}\n`);
  superviseChild({
    spawn: () => deps.spawnChild(program, command.slice(1), trust.env as NodeJS.ProcessEnv),
    onSignal: deps.onSignal,
    exit: deps.exit,
    log: (line) => deps.stdout(`${line}\n`),
    endNonzeroOnChildExit: flagged,
  });
}

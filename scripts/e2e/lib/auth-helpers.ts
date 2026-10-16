// auth-helpers.ts — helpers shared by the four scripts/e2e/auth-<cli>.ts entries (spec 0261).
// Everything printed goes through `say`/`emit` on stderr; docker is always resolved on env.PATH.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { findOnPath } from "../../../tests/e2e/lib/exec.ts";
import { ExitError, e2eInfo, type CallResult, type Env } from "./auth-common.ts";

/** Print one informational line on stderr (`e2e_info`). */
export function say(msg: string): void {
  process.stderr.write(e2eInfo(msg).stderr);
}

/** Print what a helper call wrote on stderr. */
export function emit(result: CallResult): void {
  process.stderr.write(result.stderr);
}

/** Bash's `shopt -s nullglob; "${dir}"/*<suffix>`: regular files, no dotfiles, sorted. */
export function globFiles(dir: string, suffix: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(suffix) && !n.startsWith("."))
    .filter((n) => {
      try {
        return fs.statSync(path.join(dir, n)).isFile();
      } catch {
        return false;
      }
    })
    .sort();
}

/** `docker <args>` with the caller's terminal attached; the exit status (non-zero on spawn failure). */
export function dockerInteractive(env: Env, args: readonly string[]): number {
  const exe = findOnPath("docker", env);
  if (exe === null) return 127;
  const res = spawnSync(exe, [...args], { env: { ...env }, stdio: "inherit", shell: false });
  return res.status ?? 128;
}

export function toEnv(raw: NodeJS.ProcessEnv): Env {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) if (v !== undefined) out[k] = v;
  return out;
}

/** Run `body`; an ExitError prints what the helper wrote and yields its status. */
export function guarded(body: () => number): number {
  try {
    return body();
  } catch (e) {
    if (e instanceof ExitError) {
      process.stderr.write(e.stderr);
      return e.status;
    }
    throw e;
  }
}

/** Report files missing from `dir` the way the interactive scripts do; true when any. */
export function reportMissing(
  cli: string,
  dir: string,
  names: readonly string[],
  hint: string,
): boolean {
  const missing = names.filter((n) => {
    try {
      return !fs.statSync(path.join(dir, n)).isFile();
    } catch {
      return true;
    }
  });
  if (missing.length === 0) return false;
  say(`[${cli}] WARNING: expected credential file(s) not found in ${dir}:`);
  for (const f of missing) say(`  - ${f}`);
  say(hint);
  return true;
}

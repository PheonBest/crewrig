// git-run.ts — spawn git with an explicit working directory and environment
// (spec 0259). `ts-scope.ts` git() cannot serve: it is pinned to repoRoot(), has
// no env override and decodes output to strings, losing raw bytes.
//
// Standard library only. No shell: the arguments are an array.
//
// Usage: const res = runGit(["ls-files", "-z"], { cwd, env });
// Exit codes: not applicable (library); a spawn failure surfaces as status 127.
// Finding-line format: not applicable.

import { spawnSync } from "node:child_process";

export interface GitRunResult {
  /** Exit status; 128 + signal-less failures map to 1, a spawn error to 127. */
  status: number;
  stdout: Buffer;
  stderr: Buffer;
}

export interface GitRunOptions {
  /** Working directory git runs in (required: no implicit process cwd). */
  cwd: string;
  /** Complete environment; defaults to the current process environment. */
  env?: NodeJS.ProcessEnv;
  /** Bytes written to git's standard input. */
  input?: Buffer | string;
}

/** Run git with raw Buffer output; never throws for a non-zero exit. */
export function runGit(args: readonly string[], opts: GitRunOptions): GitRunResult {
  const res = spawnSync("git", [...args], {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    input: opts.input,
    maxBuffer: 256 * 1024 * 1024,
    shell: false,
  });
  if (res.error !== undefined) {
    return { status: 127, stdout: Buffer.alloc(0), stderr: Buffer.from(res.error.message) };
  }
  return {
    status: res.status ?? 1,
    stdout: res.stdout ?? Buffer.alloc(0),
    stderr: res.stderr ?? Buffer.alloc(0),
  };
}

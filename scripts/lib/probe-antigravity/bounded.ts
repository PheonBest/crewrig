// bounded.ts — the bounded call (the TypeScript twin of run_bounded). The child runs in its own
// process group so that a timeout takes the whole tree down, not only the wrapper it forked.

import { spawn } from "node:child_process";
import fs from "node:fs";
import { findOnPath } from "../../../tests/e2e/lib/exec.ts";

export const TIMED_OUT = 124;

export interface BoundedOptions {
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
  readonly timeoutSec: number;
}

const SIGNALS: Readonly<Record<string, number>> = { SIGHUP: 1, SIGINT: 2, SIGKILL: 9, SIGTERM: 15 };

/** Run `cmd args` with stdout to `outFile`; resolves to its status, or 124 when the bound was hit. */
export function runBounded(
  outFile: string,
  cmd: string,
  args: readonly string[],
  opts: BoundedOptions,
): Promise<number> {
  const fd = fs.openSync(outFile, "w");
  const exe = findOnPath(cmd, opts.env);
  if (exe === null) {
    fs.closeSync(fd);
    return Promise.resolve(127);
  }
  return new Promise((resolve) => {
    let timedOut = false;
    let settled = false;
    const child = spawn(exe, [...args], {
      cwd: opts.cwd,
      env: { ...opts.env },
      stdio: ["ignore", fd, "ignore"],
      detached: true,
      shell: false,
    });
    fs.closeSync(fd);
    const finish = (status: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(status);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid !== undefined) process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    }, opts.timeoutSec * 1000);
    child.on("error", () => finish(127));
    child.on("exit", (code, signal) => {
      if (timedOut) return finish(TIMED_OUT);
      if (code !== null) return finish(code);
      finish(128 + (SIGNALS[signal ?? ""] ?? 0));
    });
  });
}

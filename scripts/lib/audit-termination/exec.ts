// exec.ts — the real process boundary: git and gh only (parent R23), logged.

import { spawnSync } from "node:child_process";
import type { Run } from "./types.ts";

/** Wrap spawnSync for `git` and `gh`; every call is passed to `log` before it runs. */
export function realRun(log: (line: string) => void): Run {
  return (cmd, args, cwd) => {
    log(`${cwd === undefined ? "" : `(cwd ${cwd}) `}${cmd} ${args.join(" ")}`);
    const r = spawnSync(cmd, [...args], {
      cwd,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
    return {
      status: r.status ?? 1,
      stdout: r.stdout ?? "",
      stderr: r.stderr ?? r.error?.message ?? "",
    };
  };
}

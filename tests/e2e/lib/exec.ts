// exec.ts — the two host-tool primitives shared by the TypeScript twins of the e2e libraries.
// No shell is ever involved: a tool is found on the PATH of the caller's `env` and spawned with
// an argument array (spec 0261 R4). The environment is a parameter, never `process.env`.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface ToolResult {
  readonly rc: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface RunOptions {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly input?: string;
}

const isWindows = path.sep === "\\";

function envValue(env: Readonly<Record<string, string>>, key: string): string {
  if (env[key] !== undefined) return env[key];
  if (!isWindows) return "";
  const hit = Object.keys(env).find((k) => k.toUpperCase() === key);
  return hit === undefined ? "" : (env[hit] ?? "");
}

/** `command -v <name>` for a file: the first executable match on `env.PATH` (PATHEXT on Windows). */
export function findOnPath(name: string, env: Readonly<Record<string, string>>): string | null {
  const exts = isWindows
    ? [
        "",
        ...envValue(env, "PATHEXT")
          .split(";")
          .filter((e) => e !== ""),
      ]
    : [""];
  const dirs = name.includes(path.sep) ? [""] : envValue(env, "PATH").split(path.delimiter);
  for (const dir of dirs) {
    if (dir === "" && !name.includes(path.sep)) continue;
    for (const ext of exts) {
      const candidate = dir === "" ? name + ext : path.join(dir, name + ext);
      try {
        if (!fs.statSync(candidate).isFile()) continue;
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // not here, try the next candidate
      }
    }
  }
  return null;
}

/** Spawn `file` (resolved on `env.PATH`) with an argument array and no shell. */
export function runTool(file: string, args: readonly string[], opts: RunOptions): ToolResult {
  const exe = findOnPath(file, opts.env);
  if (exe === null) return { rc: 127, stdout: "", stderr: `${file}: command not found\n` };
  const res = spawnSync(exe, [...args], {
    cwd: opts.cwd,
    env: { ...opts.env },
    input: opts.input ?? "",
    encoding: "utf8",
    shell: false,
  });
  if (res.error !== undefined) return { rc: 127, stdout: "", stderr: `${res.error.message}\n` };
  return { rc: res.status ?? 128, stdout: res.stdout, stderr: res.stderr };
}

// windows-packaging-driver.ts — how the cross-system proof of the packaging and release entries runs
// an entry and keeps its books (spec 0257 R27, parent R17; conventions of spec 0255 R29). Importable
// on any host: the PATH filter takes its platform data as parameters.
//
// Every entry runs through a NON-POSIX interpreter on Windows (the interpreters are resolved from
// the PARENT environment before the child's PATH is narrowed, see windows-proof-support.ts). `bash`
// is dropped from the child PATH, except `System32\bash.exe` (WSL), which sits on every runner PATH
// next to `cmd.exe` and cannot be removed: a tripwire `bash` placed FIRST on the PATH stands in for
// it, and the proof asserts the tripwire was never called ("no bash spawned", not "no bash").

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import type { SpawnSyncOptionsWithStringEncoding } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { setEnv, WIN } from "./windows-proof-support.ts";
import type { Interpreters, Run, Shell } from "./windows-proof-support.ts";

const win = path.win32;

/** One file or archive member an entry wrote, kept for the carriage-return scan of `wp-no-cr`. */
export interface Landed {
  readonly label: string;
  readonly bytes: Buffer;
}

export interface Proof {
  readonly interpreters: Interpreters;
  readonly failures: string[];
  readonly landed: Landed[];
  /** The case being run, for the failure list. */
  current: string;
}

/** Run one case; a failure is recorded with its name and the proof carries on with the next. */
export function attempt(proof: Proof, name: string, fn: () => void): void {
  const started = Date.now();
  proof.current = name;
  try {
    fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    proof.failures.push(`${name}: ${message}`);
    console.error(`windows-packaging-proof: FAIL ${name}: ${message}`);
  }
  console.log(`windows-packaging-proof: ${name}: ${Date.now() - started} ms`);
}

/** Remember a file for the carriage-return scan. */
export function land(proof: Proof, file: string): void {
  proof.landed.push({ label: file, bytes: fs.readFileSync(file) });
}

/** Captured text with CRLF folded to LF: a Windows console layer may change what a pipe carries. */
export const lines = (text: string): string => text.replaceAll("\r\n", "\n");

/** `\` to `/`: how the release driver writes a Windows path into a command string. */
export const toSlash = (value: string): string => value.replaceAll("\\", "/");

/**
 * The child's PATH: `first`, then the parent entries minus every directory that holds a `bash.exe`
 * other than `System32` (Git for Windows' `bin` and `usr\bin`). Elsewhere the parent PATH is kept
 * whole: git and sh live next to bash. Pure: platform data come in as parameters.
 */
export function childPath(
  first: readonly string[],
  parent: string,
  input: { platform: NodeJS.Platform; systemRoot: string; isFile: (file: string) => boolean },
): string {
  const sep = input.platform === "win32" ? ";" : ":";
  const kept = parent.split(sep).filter((dir) => {
    if (dir === "" || input.platform !== "win32") return dir !== "";
    const system32 = win.join(input.systemRoot, "System32").toLowerCase();
    if (win.normalize(dir).replace(/\\$/, "").toLowerCase() === system32) return true;
    return !input.isFile(win.join(dir, "bash.exe"));
  });
  return [...first, ...kept].join(sep);
}

export interface Bins {
  /** A directory holding the `bash` tripwire and, on request, a fake `gemini`. */
  readonly dir: string;
  readonly bashLog: string;
}

/** The tripwire `bash` (and, optionally, a `gemini` that validates successfully) in a fresh directory. */
export function writeBins(dir: string, withGemini: boolean): Bins {
  fs.mkdirSync(dir, { recursive: true });
  const bashLog = path.join(dir, "bash-calls.log");
  if (WIN) {
    fs.writeFileSync(
      path.join(dir, "bash.cmd"),
      `@echo off\r\n>>"${bashLog}" echo %*\r\nexit /b 99\r\n`,
    );
    if (withGemini) fs.writeFileSync(path.join(dir, "gemini.cmd"), "@echo off\r\nexit /b 0\r\n");
  } else {
    fs.writeFileSync(path.join(dir, "bash"), `#!/bin/sh\necho "$@" >> '${bashLog}'\nexit 99\n`, {
      mode: 0o755,
    });
    if (withGemini)
      fs.writeFileSync(path.join(dir, "gemini"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  }
  return { dir, bashLog };
}

/** No call reached the tripwire. */
export function assertNoBash(bins: Bins): void {
  if (fs.existsSync(bins.bashLog))
    assert.fail(`bash was spawned: ${fs.readFileSync(bins.bashLog, "utf8")}`);
}

export interface EntryRun {
  /** `scripts/<entry>.ts` of the tree. */
  readonly script: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly shell: Shell;
  /** The whole child environment, PATH included. */
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly interpreters: Interpreters;
}

const head = (text: string): string => (text.length > 2000 ? `${text.slice(0, 2000)}...` : text);

/** Run an entry (POSIX: node directly; Windows: through the absolute interpreter) and record it. */
export function runEntry(o: EntryRun): Run {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(o.env))
    if (value !== undefined) setEnv(env, key, value);
  const started = process.hrtime.bigint();
  const argv = [process.execPath, o.script, ...o.args];
  const ps = `& ${argv.map((a) => `'${a.replaceAll("'", "''")}'`).join(" ")}; exit $LASTEXITCODE`;
  const cmd = `"${argv.map((a) => `"${a}"`).join(" ")}"`;
  const base = { encoding: "utf8", env, cwd: o.cwd, windowsHide: true } as const;
  const spawned: [string, string[], SpawnSyncOptionsWithStringEncoding] = !WIN
    ? [process.execPath, argv.slice(1), base]
    : o.shell === "cmd"
      ? [o.interpreters.cmd, ["/d", "/s", "/c", cmd], { ...base, windowsVerbatimArguments: true }]
      : [o.interpreters.pwsh, ["-NoProfile", "-NonInteractive", "-Command", ps], base];
  const res = spawnSync(spawned[0], spawned[1], spawned[2]);
  const ms = Number((process.hrtime.bigint() - started) / 1_000_000n);
  const out = lines(res.stdout ?? "");
  const err = lines(res.stderr ?? "");
  const detail = [
    `  command: ${JSON.stringify([spawned[0], ...spawned[1]])}`,
    `  cwd: ${o.cwd}`,
    `  spawn error: ${res.error?.message ?? "none"}`,
    `  status: ${res.status}, signal: ${res.signal}`,
    `  stdout: ${JSON.stringify(head(out))}`,
    `  stderr: ${JSON.stringify(head(err))}`,
  ].join("\n");
  return { entry: path.basename(o.script), status: res.status, out, err, ms, detail };
}

/**
 * The hermetic environment of a child: no CI or forge variable, the Windows system variables a
 * `cmd.exe` and the temporary directory need, the given PATH and extras.
 */
export function baseEnv(
  pathValue: string,
  home: string,
  tmp: string,
  extra: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const env: Record<string, string> = {};
  const keep = WIN ? ["SystemRoot", "windir", "ComSpec", "PATHEXT"] : [];
  for (const key of keep) {
    const value = process.env[key] ?? process.env[key.toUpperCase()];
    if (value !== undefined) env[key] = value;
  }
  Object.assign(env, { PATH: pathValue, HOME: home, USERPROFILE: home, ...extra });
  for (const key of ["TMPDIR", "TMP", "TEMP"]) env[key] = tmp;
  return env;
}

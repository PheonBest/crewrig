// io.ts — shared plumbing of the MCP token probe twin: the context every question receives (env, cwd
// and the two output sinks are parameters, never process globals), no-shell child runners with
// bounded waits, and the small text helpers the shell got from sed/diff/date.

import { spawnSync } from "node:child_process";
import fs from "node:fs";

import { findOnPath } from "../../../tests/e2e/lib/exec.ts";

export type Env = Readonly<Record<string, string>>;

export interface Ctx {
  readonly env: Env;
  readonly cwd: string;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  /** The mktemp-style scratch directory, removed by the caller in a finally. */
  readonly work: string;
  /** The shell's FAILED flag: a question could not give a definite answer (exit 2). */
  failed: boolean;
  seq: number;
}

/** What `set -e` does in the shell: a command that must succeed did not, so the probe stops. */
export class Abort extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`aborted with status ${status}`);
    this.status = status;
  }
}

export function onPath(ctx: Ctx, name: string): boolean {
  return findOnPath(name, ctx.env) !== null;
}

export function line(ctx: Ctx, text = ""): void {
  ctx.out(`${text}\n`);
}

export function section(ctx: Ctx, title: string): void {
  line(ctx);
  line(ctx, "=".repeat(58));
  line(ctx, `  ${title}`);
  line(ctx, "=".repeat(58));
}

/** `sed 's/^/<prefix>/'`: every line prefixed, a missing final newline supplied, empty input empty. */
export function prefixLines(text: string, prefix: string): string {
  if (text === "") return "";
  const lines = text.split("\n");
  if (text.endsWith("\n")) lines.pop();
  return lines.map((l) => `${prefix}${l}\n`).join("");
}

/** `$(...)` strips trailing newlines. */
export const stripTrailingNewlines = (text: string): string => text.replace(/\n+$/, "");

/** `date -u +%Y-%m-%dT%H:%M:%S.000Z` */
export function launchInstant(): string {
  return `${new Date().toISOString().slice(0, 19)}.000Z`;
}

export interface RunOpts {
  readonly env?: Env;
  readonly timeoutMs?: number;
}

function statusOf(res: ReturnType<typeof spawnSync>): number {
  if (res.error !== undefined)
    return (res.error as NodeJS.ErrnoException).code === "ETIMEDOUT" ? 124 : 127;
  return res.status ?? 128;
}

function launch(
  ctx: Ctx,
  file: string,
  args: readonly string[],
  opts: RunOpts,
  stdio: unknown,
): number {
  const env = opts.env ?? ctx.env;
  const exe = findOnPath(file, env);
  if (exe === null) return 127;
  const res = spawnSync(exe, [...args], {
    cwd: ctx.cwd,
    env: { ...env },
    stdio: stdio as never,
    shell: false,
    ...(opts.timeoutMs === undefined ? {} : { timeout: opts.timeoutMs }),
  });
  return statusOf(res);
}

/** `cmd >/dev/null 2>&1 </dev/null`: the status only. */
export function runQuiet(
  ctx: Ctx,
  file: string,
  args: readonly string[],
  opts: RunOpts = {},
): number {
  return launch(ctx, file, args, opts, "ignore");
}

/** `cmd </dev/null >file 2>&1`: stdout and stderr share one descriptor, as the shell's redirection does. */
export function runToFile(
  ctx: Ctx,
  file: string,
  args: readonly string[],
  target: string,
  opts: RunOpts = {},
): number {
  const fd = fs.openSync(target, "w");
  try {
    return launch(ctx, file, args, opts, ["ignore", fd, fd]);
  } finally {
    fs.closeSync(fd);
  }
}

/** `$(cmd 2>&1 || true)`: merged output with trailing newlines stripped. */
export function captureMerged(
  ctx: Ctx,
  file: string,
  args: readonly string[],
  opts: RunOpts = {},
): string {
  const target = `${ctx.work}/capture-${ctx.seq++}.log`;
  runToFile(ctx, file, args, target, opts);
  const text = fs.readFileSync(target, "utf8");
  fs.rmSync(target, { force: true });
  return stripTrailingNewlines(text);
}

/** `$(cmd 2>/dev/null || true)`: stdout only, trailing newlines stripped, whatever the status. */
export function captureStdoutOnly(ctx: Ctx, file: string, args: readonly string[]): string {
  const target = `${ctx.work}/capture-${ctx.seq++}.out`;
  const fd = fs.openSync(target, "w");
  try {
    launch(ctx, file, args, { timeoutMs: 30_000 }, ["ignore", fd, "ignore"]);
  } finally {
    fs.closeSync(fd);
  }
  const text = fs.readFileSync(target, "utf8");
  fs.rmSync(target, { force: true });
  return stripTrailingNewlines(text);
}

/** `cmd >/dev/null 2>&1` under `set -e`: a failure ends the probe with that status. */
export function mustRun(ctx: Ctx, file: string, args: readonly string[], opts: RunOpts = {}): void {
  const status = runQuiet(ctx, file, args, opts);
  if (status !== 0) throw new Abort(status);
}

export const nonEmpty = (file: string): boolean => {
  try {
    return fs.statSync(file).size > 0;
  } catch {
    return false;
  }
};

/** The stub MCP server every variant installs: appends its argv and cwd to `log`, lingers briefly. */
export function writeStub(file: string, log: string): void {
  const body = `#!/bin/bash\n{\n  echo "ARGV: \\$*"\n  echo "CWD: \\$(pwd)"\n} >> "${log}"\nsleep 0.2\nexit 0\n`;
  fs.writeFileSync(file, body.replaceAll("\\$", "$"), { mode: 0o755 });
  fs.chmodSync(file, 0o755);
}

function splitLines(text: string): string[] {
  const lines = text.split("\n");
  if (text.endsWith("\n")) lines.pop();
  return lines;
}

/** `diff a b` (normal format): one hunk spanning everything between the common head and tail. */
export function normalDiff(a: string, b: string): string {
  const x = splitLines(a);
  const y = splitLines(b);
  let head = 0;
  while (head < x.length && head < y.length && x[head] === y[head]) head++;
  let tail = 0;
  while (
    tail < x.length - head &&
    tail < y.length - head &&
    x[x.length - 1 - tail] === y[y.length - 1 - tail]
  )
    tail++;
  const xs = x.slice(head, x.length - tail);
  const ys = y.slice(head, y.length - tail);
  if (xs.length === 0 && ys.length === 0) return "";
  const range = (start: number, n: number): string =>
    n <= 1 ? `${start}` : `${start},${start + n - 1}`;
  const op = xs.length === 0 ? "a" : ys.length === 0 ? "d" : "c";
  const left = xs.length === 0 ? `${head}` : range(head + 1, xs.length);
  const right = ys.length === 0 ? `${head}` : range(head + 1, ys.length);
  const body = [
    ...xs.map((l) => `< ${l}`),
    ...(op === "c" ? ["---"] : []),
    ...ys.map((l) => `> ${l}`),
  ];
  return `${left}${op}${right}\n${body.join("\n")}\n`;
}

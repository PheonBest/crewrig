// e2e-docker-standin.ts — a fake `docker` executable for the end-to-end harness oracle (spec 0261
// R5, R7, R8): it answers every call from a JSON fixture table, so a verdict of the shell harness
// can be recorded, and later replayed against the TypeScript port, without a container engine or
// an account. It never spawns anything.
//
// Environment:
//   E2E_STANDIN_FIXTURES        JSON table `{ "<scenario>/<cli>": [ entry, ... ] }`; one entry per
//                               docker call, consumed by ordinal. An entry is `{ match?: string[]
//                               (argv prefix to check), stdout?, stderr?, exit?, files?: { "<container
//                               path>": "<content>" } }`.
//   E2E_STANDIN_CASE            the `<scenario>/<cli>` key.
//   E2E_STANDIN_STATE           directory holding the per-case ordinal counter file.
//   E2E_STANDIN_LOG             JSON-lines file; one record per call: ordinal, argv, resulting exit.
//   E2E_STANDIN_FORBID_RUN=1    any `run` exits 99 with `standin: docker run forbidden`.
//   E2E_STANDIN_MISSING_IMAGES  comma-separated image names that `image inspect` reports missing.
//
// Sub-verbs: `image inspect` exits 0 (1 for a missing image) unless a fixture answers it; `version`,
// `info`, `volume create|rm`, `rm`, `network *`, `cp` exit 0 unless a fixture answers them (they
// consume an ordinal only when a fixture is present for it, see `isQuiet`); `run` and everything
// else answer from the fixture of the next ordinal. A call with no fixture left exits 97.
// Fixture text tokens: see `expandTokens`.
// `files` entries are written to the host path obtained through the `-v host:container[:mode]`
// bind mounts of the same argv, longest container prefix first.

import fs from "node:fs";
import path from "node:path";

export type Env = Readonly<Record<string, string | undefined>>;

export interface FixtureEntry {
  readonly match?: readonly string[];
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exit?: number;
  readonly files?: Readonly<Record<string, string>>;
}

export interface Result {
  readonly stdout: string;
  readonly stderr: string;
  readonly exit: number;
}

const COUNTER = "ordinal";

function readTable(env: Env): Record<string, readonly FixtureEntry[]> {
  const file = env.E2E_STANDIN_FIXTURES;
  if (file === undefined || file === "") return {};
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, readonly FixtureEntry[]>;
}

function counterFile(env: Env): string {
  const dir = env.E2E_STANDIN_STATE ?? "";
  const key = (env.E2E_STANDIN_CASE ?? "case").replace(/[^A-Za-z0-9._-]/g, "_");
  return path.join(dir, `${COUNTER}-${key}`);
}

function readOrdinal(env: Env): number {
  try {
    return Number(fs.readFileSync(counterFile(env), "utf8")) || 0;
  } catch {
    return 0;
  }
}

function log(env: Env, ordinal: number, argv: readonly string[], exit: number): void {
  const file = env.E2E_STANDIN_LOG;
  if (file === undefined || file === "") return;
  fs.appendFileSync(file, `${JSON.stringify({ ordinal, argv, exit })}\n`);
}

/** Host path for a container path through the `-v host:container[:mode]` mounts; longest prefix wins. */
function mapPath(argv: readonly string[], containerPath: string): string | undefined {
  const mounts: Array<[string, string]> = [];
  for (let i = 0; i < argv.length - 1; i++) {
    const flag = argv[i];
    const value = argv[i + 1] ?? "";
    if (flag !== "-v" && flag !== "--volume") continue;
    const [host, container] = value.split(":");
    if (host !== undefined && container !== undefined) mounts.push([host, container]);
  }
  mounts.sort((a, b) => b[1].length - a[1].length);
  for (const [host, container] of mounts) {
    const base = container.replace(/\/+$/, "");
    if (containerPath === base) return host;
    if (containerPath.startsWith(`${base}/`))
      return path.join(host, containerPath.slice(base.length));
  }
  return undefined;
}

function matches(entry: FixtureEntry, argv: readonly string[]): boolean {
  return (entry.match ?? []).every((word, i) => argv[i] === word);
}

/** First capture group of `pattern` over `text`, "" when it does not match or is invalid. */
function capture(pattern: string, text: string): string {
  try {
    return new RegExp(pattern).exec(text)?.[1] ?? "";
  } catch {
    return "";
  }
}

/** Read a container path through the bind mounts of the call; "" when it is not mounted/readable. */
function readMounted(argv: readonly string[], containerPath: string): string {
  const host = mapPath(argv, containerPath);
  try {
    return host === undefined ? "" : fs.readFileSync(host, "utf8");
  } catch {
    return "";
  }
}

/**
 * Template tokens of a fixture's stdout, stderr and files contents, so a fixture can echo what the
 * call asked: `{{ARGV_LAST}}` (the last argument), `{{ARG_MATCH:<regex>}}` (first capture group of
 * the regex over the space-joined argv) and `{{FILE_MATCH:<container path>::<regex>}}` (first
 * capture group of the regex over a file reached through the call's bind mounts).
 */
export function expandTokens(text: string, argv: readonly string[]): string {
  return text
    .replaceAll("{{ARGV_LAST}}", () => argv[argv.length - 1] ?? "")
    .replace(/\{\{ARG_MATCH:(.*?)\}\}/gs, (_all, re: string) => capture(re, argv.join(" ")))
    .replace(/\{\{FILE_MATCH:(.*?)::(.*?)\}\}/gs, (_all, file: string, re: string) =>
      capture(re, readMounted(argv, file)),
    );
}

function answer(entry: FixtureEntry, argv: readonly string[]): Result {
  for (const [containerPath, content] of Object.entries(entry.files ?? {})) {
    const host = mapPath(argv, containerPath);
    if (host === undefined) continue;
    fs.mkdirSync(path.dirname(host), { recursive: true });
    fs.writeFileSync(host, expandTokens(content, argv));
  }
  return {
    stdout: expandTokens(entry.stdout ?? "", argv),
    stderr: expandTokens(entry.stderr ?? "", argv),
    exit: entry.exit ?? 0,
  };
}

function isQuiet(argv: readonly string[]): boolean {
  const [verb, sub] = argv;
  return (
    verb === "version" ||
    verb === "info" ||
    verb === "rm" ||
    verb === "cp" ||
    verb === "network" ||
    (verb === "volume" && (sub === "create" || sub === "rm")) ||
    (verb === "image" && sub === "inspect")
  );
}

/** Execute one fake docker call and return its streams and status; the caller prints and exits. */
export function run(argv: readonly string[], env: Env): Result {
  const ordinal = readOrdinal(env);
  const finish = (result: Result, consumed: boolean): Result => {
    if (consumed && env.E2E_STANDIN_STATE) {
      fs.mkdirSync(env.E2E_STANDIN_STATE, { recursive: true });
      fs.writeFileSync(counterFile(env), String(ordinal + 1));
    }
    log(env, ordinal, argv, result.exit);
    return result;
  };
  if (argv[0] === "run" && env.E2E_STANDIN_FORBID_RUN === "1") {
    return finish({ stdout: "", stderr: "standin: docker run forbidden\n", exit: 99 }, false);
  }
  const key = env.E2E_STANDIN_CASE ?? "";
  const entries = readTable(env)[key] ?? [];
  const entry = entries[ordinal];
  if (
    isQuiet(argv) &&
    (entry === undefined || !matches(entry, argv) || entry.match === undefined)
  ) {
    if (argv[0] === "image" && argv[1] === "inspect") {
      const image = argv[argv.length - 1] ?? "";
      const missing = (env.E2E_STANDIN_MISSING_IMAGES ?? "").split(",").filter(Boolean);
      if (missing.includes(image)) {
        return finish({ stdout: "", stderr: `Error: No such image: ${image}\n`, exit: 1 }, false);
      }
    }
    return finish({ stdout: "", stderr: "", exit: 0 }, false);
  }
  if (entry === undefined || !matches(entry, argv)) {
    const why = entry === undefined ? "missing fixture" : "unexpected call, expected another at";
    return finish({ stdout: "", stderr: `standin: ${why} ${key}#${ordinal}\n`, exit: 97 }, false);
  }
  return finish(answer(entry, argv), true);
}

export function main(argv: readonly string[], env: Env): number {
  const result = run(argv, env);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  return result.exit;
}

/** Generate an executable `docker` (POSIX) and a `docker.cmd` (Windows) into `dir`; never tracked. */
export function writeLauncher(dir: string): { posix: string; cmd: string } {
  const node = process.execPath;
  const self = import.meta.filename;
  const flag = "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON";
  fs.mkdirSync(dir, { recursive: true });
  const posix = path.join(dir, "docker");
  const cmd = path.join(dir, "docker.cmd");
  fs.writeFileSync(posix, `#!/bin/sh\nexec "${node}" ${flag} "${self}" "$@"\n`, { mode: 0o755 });
  fs.chmodSync(posix, 0o755);
  fs.writeFileSync(cmd, `@echo off\r\n"${node}" ${flag} "${self}" %*\r\n`);
  return { posix, cmd };
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename) {
  process.exitCode = main(process.argv.slice(2), process.env);
}

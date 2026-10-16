// e2e-suite-kit.ts — shared scratch sandbox for the migrated end-to-end Bash suites (spec 0261 R19):
// a scratch HOME, the Docker stand-in launcher first on PATH, and a node spawner for the TypeScript
// entries. Never real docker, never the real HOME, never an account.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { parseToml, type TomlTable, type TomlValue } from "../../../tests/e2e/lib/toml_subset.ts";
import { writeLauncher } from "./e2e-docker-standin.ts";

export const REPO = path.resolve(import.meta.dirname, "..", "..", "..");
export const NODE_FLAG = "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON";
const CREDENTIAL_VARS = ["ANTHROPIC_API_KEY", "GEMINI_API_KEY", "COPILOT_GITHUB_TOKEN", "GH_TOKEN"];

export interface Scratch {
  readonly root: string;
  readonly bin: string;
  readonly home: string;
  readonly state: string;
  readonly cleanup: () => void;
}

/** A scratch root holding `bin/` (the docker stand-in), `home/` and `state/`. */
export function makeScratch(prefix: string): Scratch {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  const bin = path.join(root, "bin");
  const home = path.join(root, "home");
  const state = path.join(root, "state");
  for (const d of [home, state]) fs.mkdirSync(d, { recursive: true });
  writeLauncher(bin);
  return {
    root,
    bin,
    home,
    state,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

export function put(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

export interface RunResult {
  readonly status: number | null;
  readonly out: string;
  readonly stdout: string;
  readonly stderr: string;
}

/** Environment for one run: scratch HOME, stand-in first on PATH, no credential variables. */
export function sandboxEnv(
  s: Scratch,
  extra: Readonly<Record<string, string>> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const v of CREDENTIAL_VARS) delete env[v];
  return {
    ...env,
    HOME: s.home,
    USERPROFILE: s.home,
    PATH: `${s.bin}${path.delimiter}${process.env["PATH"] ?? ""}`,
    E2E_STANDIN_STATE: s.state,
    ...extra,
  };
}

/** Run `node <entry> <args>` with the given environment; stdin is closed. */
export function runEntry(
  entry: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): RunResult {
  const r = spawnSync(process.execPath, [NODE_FLAG, entry, ...args], {
    env,
    cwd: REPO,
    encoding: "utf8",
    input: "",
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, out: `${r.stdout}${r.stderr}` };
}

/** The `-v` binds of every recorded `docker run` call. */
export function dockerRunBinds(logFile: string): string[] {
  if (!fs.existsSync(logFile)) return [];
  const binds: string[] = [];
  for (const line of fs.readFileSync(logFile, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    const argv = (JSON.parse(line) as { argv: string[] }).argv;
    if (argv[0] !== "run") continue;
    for (let i = 0; i < argv.length - 1; i++) if (argv[i] === "-v") binds.push(argv[i + 1] ?? "");
  }
  return binds;
}

/** Slash-normalise a bind or path so the comparison holds on Windows. */
export const slashed = (s: string): string => s.replace(/\\/g, "/");

function toPlain(v: TomlValue): unknown {
  if (v instanceof Map) return Object.fromEntries([...v].map(([k, x]) => [k, toPlain(x)]));
  if (Array.isArray(v)) return v.map(toPlain);
  return v;
}

/** A TOML file of the repository as a plain object. */
export function readToml(rel: string): Record<string, unknown> {
  const file = path.join(REPO, rel);
  const table: TomlTable = parseToml(fs.readFileSync(file, "utf8"), file);
  return toPlain(table) as Record<string, unknown>;
}

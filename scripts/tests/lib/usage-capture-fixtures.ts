// usage-capture-fixtures.ts — shared helpers for the usage-capture TypeScript
// tests (spec 0260, replacement of scripts/tests/test-usage-capture.sh).
//
// The companion drivers usage-capture-derive.js and materialize-copilot-db.js are
// KEPT as they are (JavaScript ratchet baseline) and spawned per call, so every
// derivation keeps its own CREWRIG_USAGE_ROOT isolation and its pinned PATH.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const FIXTURES_DIR = path.join(REPO, "scripts", "tests", "fixtures", "usage-capture");
export const MUTANTS_DIR = path.join(
  REPO,
  "scripts",
  "tests",
  "fixtures",
  "usage-records",
  "mutants",
);
export const DERIVATION_DIR = path.join(
  REPO,
  "scripts",
  "tests",
  "fixtures",
  "usage-records",
  "derivation",
);
export const DERIVE_JS = path.join(REPO, "scripts", "tests", "lib", "usage-capture-derive.js");
export const MATERIALIZE_JS = path.join(
  REPO,
  "scripts",
  "tests",
  "lib",
  "materialize-copilot-db.js",
);
export const VALIDATOR_JS = path.join(REPO, "scripts", "lib", "usage-record-validator.js");

const NODE_FLAGS = ["--disable-warning=ExperimentalWarning"];

export interface Expected {
  readonly adapter: string;
  readonly captured: number;
  readonly uncaptured: number;
  readonly [key: string]: unknown;
}

export interface UsageFixture {
  /** Path under the fixtures root, e.g. `gemini-cli/legacy-json`. */
  readonly label: string;
  readonly dir: string;
  readonly expectedFile: string;
  readonly expected: Expected;
}

function walk(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name === "expected.json") out.push(full);
  }
}

/** Every `expected.json` carrying an `adapter` key (payloads/expected.json has none). */
export function discoverFixtures(): UsageFixture[] {
  const files: string[] = [];
  walk(FIXTURES_DIR, files);
  const found: UsageFixture[] = [];
  for (const expectedFile of files.sort()) {
    const expected = JSON.parse(fs.readFileSync(expectedFile, "utf8")) as Expected;
    if (!("adapter" in expected)) continue;
    const dir = path.dirname(expectedFile);
    const label = path.relative(FIXTURES_DIR, dir).split(path.sep).join("/");
    found.push({ label, dir, expectedFile, expected });
  }
  return found;
}

/** Hermetic child environment: scratch HOME/USERPROFILE, no CI or proxy leakage. */
export function hermeticEnv(
  home: string,
  extra: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(https?_proxy|all_proxy|no_proxy)$/i.test(key)) delete env[key];
  }
  for (const key of ["CI", "NODE_OPTIONS", "NODE_TEST_CONTEXT", "USAGE_CAPTURE_MODULE_ROOT"]) {
    delete env[key];
  }
  env.HOME = home;
  env.USERPROFILE = home;
  env.NO_PROXY = "127.0.0.1,localhost";
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

export function mkTemp(prefix: string): string {
  return fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

export interface DeriveResult {
  readonly rc: number | null;
  readonly output: string;
  readonly outDir: string;
  readonly captured: number | null;
  readonly uncaptured: number | null;
  readonly total: number | null;
  readonly stored: number | null;
  readonly duplicate: number | null;
  readonly rejected: number | null;
}

export interface DeriveOptions {
  /** CREWRIG_USAGE_ROOT for the child (always a temp directory). */
  readonly usageRoot: string;
  readonly outDir: string;
  readonly home: string;
  /** Absolute alternate module tree (USAGE_CAPTURE_MODULE_ROOT). */
  readonly moduleRoot?: string;
}

function num(match: RegExpMatchArray | null, i: number): number | null {
  return match === null ? null : Number(match[i]);
}

/** Spawn usage-capture-derive.js: `derive(["gemini-cli", file, "--submit", "1"], opts)`. */
export function derive(args: readonly string[], opts: DeriveOptions): DeriveResult {
  const env = hermeticEnv(opts.home, {
    CREWRIG_USAGE_ROOT: opts.usageRoot,
    USAGE_CAPTURE_MODULE_ROOT: opts.moduleRoot,
  });
  const res = spawnSync(
    process.execPath,
    [...NODE_FLAGS, DERIVE_JS, ...args, "--out", opts.outDir],
    { encoding: "utf8", env },
  );
  const output = `${res.stdout}${res.stderr}`;
  const result = /RESULT captured=(\d+) uncaptured=(\d+) total=(\d+)/.exec(output);
  const submit = /SUBMIT stored=(\d+) duplicate=(\d+) rejected=(\d+)/.exec(output);
  return {
    rc: res.status,
    output,
    outDir: opts.outDir,
    captured: num(result, 1),
    uncaptured: num(result, 2),
    total: num(result, 3),
    stored: num(submit, 1),
    duplicate: num(submit, 2),
    rejected: num(submit, 3),
  };
}

/** Materialize a copilot-cli fixture's schema.sql + rows.sql into a sqlite file. */
export function materializeDb(fixtureDir: string, dbFile: string, home: string): void {
  const res = spawnSync(process.execPath, [...NODE_FLAGS, MATERIALIZE_JS, fixtureDir, dbFile], {
    encoding: "utf8",
    env: hermeticEnv(home),
  });
  if (res.status !== 0) {
    throw new Error(
      `materializing the fixture sqlite db failed (exit ${res.status}): ${res.stderr}`,
    );
  }
}

/**
 * SAFETY: never point HOME at a git-tracked fixture path (a real CLI once wrote 136 MiB
 * into one). Copy `<fixtureDir>/home` into a throwaway directory, or hand back an empty one.
 */
export function copyFixtureHome(fixtureDir: string, dest: string): string {
  const src = path.join(fixtureDir, "home");
  if (fs.existsSync(src)) fs.cpSync(src, dest, { recursive: true });
  else fs.mkdirSync(dest, { recursive: true });
  return dest;
}

function recFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^rec-.*\.json$/.test(f))
    .sort()
    .map((f) => path.join(dir, f));
}

/** Schema-validate every `rec-*.json` under `dir`; returns the first failure detail or null. */
export function validateDir(dir: string, home: string): string | null {
  for (const file of recFiles(dir)) {
    const res = spawnSync(process.execPath, [...NODE_FLAGS, VALIDATOR_JS, file], {
      encoding: "utf8",
      env: hermeticEnv(home),
    });
    const out = `${res.stdout}${res.stderr}`;
    if (res.status !== 0 || !out.includes(": OK")) return `${file}: ${out}`;
  }
  return null;
}

/** One line per `forbiddenText` canary of the fixture found in any `rec-*.json` under `dir`. */
export function forbiddenHits(
  expected: { readonly forbiddenText?: unknown },
  dir: string,
): string[] {
  const canaries = Array.isArray(expected.forbiddenText) ? expected.forbiddenText : [];
  const hits: string[] = [];
  for (const canary of canaries) {
    if (typeof canary !== "string" || canary === "") continue;
    for (const file of recFiles(dir)) {
      if (fs.readFileSync(file, "utf8").includes(canary)) {
        hits.push(`${canary} found in ${path.basename(file)}`);
      }
    }
  }
  return hits;
}

export interface UsageRecordView {
  readonly provenance: { readonly cliVersion?: string; readonly formatFingerprint?: string };
  readonly tokens: Record<string, unknown>;
  readonly modelId?: string;
  readonly identity?: { readonly sessionId?: string };
  readonly raw?: Record<string, unknown> & { readonly stats?: Record<string, unknown> };
}

/** Parsed `rec-<n>.json` of a derivation output directory. */
export function readRecord(dir: string, n = 0): UsageRecordView {
  return JSON.parse(fs.readFileSync(path.join(dir, `rec-${n}.json`), "utf8")) as UsageRecordView;
}

/** Whether this Node exposes node:sqlite unflagged (the copilot-cli adapter needs it). */
export function hasNodeSqlite(): boolean {
  const res = spawnSync(process.execPath, [...NODE_FLAGS, "-e", "require('node:sqlite')"], {
    encoding: "utf8",
  });
  return res.status === 0;
}

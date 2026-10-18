// runner-config.ts — report directory, pruning, the effective config and the TAP emitter of the
// e2e runner (twin of the matching blocks of tests/e2e/run.sh).

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { tomlMerge } from "./toml_merge.ts";

export type Json = Record<string, unknown>;

export interface RunnerClock {
  readonly now: () => Date;
  /** A 16-bit random number (the shell's `RANDOM % 65536`). */
  readonly random: () => number;
}

export const systemClock: RunnerClock = {
  now: () => new Date(),
  random: () => crypto.randomInt(0, 65536),
};

/** `date -u +%Y%m%dT%H%M%SZ` + `-` + `%04x` of a random number. */
export function runId(clock: RunnerClock): string {
  const stamp = clock
    .now()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  return `${stamp}-${clock.random().toString(16).padStart(4, "0")}`;
}

const byteOrder = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Keep only the newest `keep` directories of `root`, never touching the current report. */
export function pruneReports(root: string, keep: string, reportDir: string): void {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return;
  const current = path.basename(reportDir);
  const n = Number.parseInt(keep, 10);
  const kept = Number.isNaN(n) ? 0 : Math.max(n, 0);
  const names = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== current)
    .map((e) => e.name)
    .sort(byteOrder)
    .reverse();
  for (const name of names.slice(kept))
    fs.rmSync(path.join(root, name), { recursive: true, force: true });
}

export interface EffectiveResult {
  readonly rc: number;
  readonly stderr: string;
  readonly info: string;
}

/** defaults.toml (+ local.toml when present) -> `<reportDir>/effective.json`. */
export function writeEffective(
  e2eDir: string,
  reportDir: string,
  env: Readonly<Record<string, string>>,
): EffectiveResult {
  const out = path.join(reportDir, "effective.json");
  const local = path.join(e2eDir, "local.toml");
  const hasLocal = fs.existsSync(local) && fs.statSync(local).isFile();
  const args = hasLocal
    ? [path.join(e2eDir, "defaults.toml"), local]
    : [path.join(e2eDir, "defaults.toml")];
  const res = tomlMerge(args, e2eDir, env);
  fs.writeFileSync(out, res.stdout);
  if (res.rc !== 0) return { rc: res.rc, stderr: res.stderr, info: "" };
  const info = hasLocal
    ? `[runner] merged defaults.toml + local.toml → ${out}\n`
    : `[runner] using defaults.toml (no local.toml present) → ${out}\n`;
  return { rc: 0, stderr: res.stderr, info };
}

const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
export const obj = (v: unknown): Json => (isObj(v) ? v : {});
export const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))) : [];

export const scenarioKeys = (eff: Json): string[] =>
  Object.keys(obj(eff["scenarios"])).sort(byteOrder);

/** The TAP emitter: counters plus a sink writing each line to stdout and to run.tap. */
export class Tap {
  index = 0;
  ok = 0;
  nok = 0;
  skip = 0;
  private readonly sink: (line: string) => void;
  constructor(sink: (line: string) => void) {
    this.sink = sink;
  }
  emit(kind: "ok" | "not_ok" | "skip", desc: string, directive = ""): void {
    this.index += 1;
    if (kind === "ok") {
      this.ok += 1;
      this.sink(`ok ${this.index} - ${desc}`);
    } else if (kind === "not_ok") {
      this.nok += 1;
      this.sink(`not ok ${this.index} - ${desc}`);
    } else {
      this.skip += 1;
      this.sink(`ok ${this.index} - ${desc} # SKIP ${directive}`);
    }
  }
}

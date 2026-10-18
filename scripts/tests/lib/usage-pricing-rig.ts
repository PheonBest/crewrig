// usage-pricing-rig.ts — shared rig of the usage-pricing suites (spec 0260, row J1a,
// replacing scripts/tests/test-usage-pricing.sh). A per-file temp CHECKOUT (a copy of
// the usage-price / usage-store trees plus the entries they load) is the only thing a
// mutation ever touches; every child runs against that copy with an environment built
// from scratch (scratch HOME and USERPROFILE, a fresh usage root and palace path, the
// offline flags) so nothing leaks from the parent and nothing is written under the
// real home.

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { applyMutation, copyTracked, type MutationCopy } from "./mutation-copy.ts";
import { REPO } from "./worktree-fixtures.ts";

export { applyMutation };
export type Checkout = MutationCopy;

export const FIXTURES = path.join(REPO, "scripts", "tests", "fixtures", "usage-pricing");
export const DRIVER = path.join(REPO, "scripts", "tests", "lib", "usage-pricing-driver.ts");
const QUIET = [
  "--disable-warning=ExperimentalWarning",
  "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
];

const PATHSPECS = [
  "scripts/lib/usage-price",
  "scripts/lib/usage-store",
  "scripts/lib/usage-dashboard",
  "scripts/lib/usage-capture",
  "scripts/lib/usage-record-validator.js",
  "scripts/lib/usage-wrapper.ts",
  "scripts/usage-price.ts",
  "scripts/usage-prune.ts",
  "scripts/usage-attribute.ts",
  "scripts/usage-dashboard.ts",
  "scripts/usage-query.ts",
  "schemas",
];

/** A copy of the libraries and entries under test, node_modules linked. */
export function makeCheckout(): Checkout {
  return copyTracked(REPO, PATHSPECS, { linkNodeModules: true });
}

/** A fresh checkout with one mutation applied; a missing needle throws (a FAIL, never a skip). */
export function mutate(rel: string, needle: string | RegExp, replacement: string): Checkout {
  const co = makeCheckout();
  try {
    applyMutation(co, rel, needle, replacement);
  } catch (error) {
    co.dispose();
    throw error;
  }
  return co;
}

export interface Result {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface Case {
  readonly root: string;
  readonly palace: string;
  readonly home: string;
  /** The child environment; `extra` entries override, `undefined` deletes. */
  env(extra?: Record<string, string | undefined>): NodeJS.ProcessEnv;
  dispose(): void;
}

/** A per-case usage root and palace path (no token file), offline, with a scratch HOME. */
export function caseRoot(): Case {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-pricing-")));
  const root = path.join(base, "usage");
  const home = path.join(base, "home");
  const palace = path.join(base, "palace");
  fs.mkdirSync(root);
  fs.mkdirSync(home);
  return {
    root,
    palace,
    home,
    env(extra = {}) {
      const env: NodeJS.ProcessEnv = {
        PATH: process.env["PATH"],
        SystemRoot: process.env["SystemRoot"],
        TEMP: process.env["TEMP"],
        TMP: process.env["TMP"],
        TMPDIR: process.env["TMPDIR"],
        HOME: home,
        USERPROFILE: home,
        CREWRIG_USAGE_ROOT: root,
        MEMPALACE_PALACE_PATH: palace,
        CREWRIG_USAGE_OFFLINE: "1",
        CREWRIG_USAGE_CAPTURE_TEST: "1",
        CREWRIG_USAGE_MIRROR: "0",
        USAGE_TEST_REPO_DIR: undefined,
      };
      for (const [key, value] of Object.entries(extra)) env[key] = value;
      for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
      return env;
    },
    dispose() {
      fs.rmSync(base, { recursive: true, force: true });
    },
  };
}

function run(args: readonly string[], env: NodeJS.ProcessEnv): Result {
  const r = spawnSync(process.execPath, [...QUIET, ...args], {
    encoding: "utf8",
    env,
    timeout: 120_000,
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** Run one driver subcommand against the checkout `co` in the case `c`. */
export function driver(
  co: Checkout,
  c: Case,
  cmd: string,
  args: readonly string[] = [],
  extra: Record<string, string | undefined> = {},
): Result {
  return run([DRIVER, cmd, ...args], c.env({ ...extra, USAGE_TEST_REPO_DIR: co.root }));
}

/** The driver's stdout parsed as JSON (the first line, so a trailing FETCHER_CALLS stays out). */
export function driverJson(
  co: Checkout,
  c: Case,
  cmd: string,
  args: readonly string[] = [],
  extra: Record<string, string | undefined> = {},
  // oxlint-disable-next-line typescript/no-explicit-any
): any {
  const r = driver(co, c, cmd, args, extra);
  if (r.status !== 0) throw new Error(`driver ${cmd} exited ${r.status}`);
  return JSON.parse(r.stdout.split("\n")[0] ?? "");
}

/** Run a usage entry (`usage-price`, `usage-prune`, ...) of the checkout. */
export function entry(
  co: Checkout,
  c: Case,
  name: string,
  args: readonly string[] = [],
  extra: Record<string, string | undefined> = {},
): Result {
  return run([path.join(co.root, "scripts", `${name}.ts`), ...args], c.env(extra));
}

/** Fresh case with the fixture price list pinned into it. */
export function pinnedCase(co: Checkout): Case {
  const c = caseRoot();
  const r = driver(co, c, "pin", [FIXTURES]);
  if (r.status !== 0) throw new Error(`pin failed: ${r.status}`);
  return c;
}

export function seedFx(co: Checkout, c: Case, date: string): void {
  const r = driver(co, c, "seed-fx", [path.join(FIXTURES, "fx", `${date}.json`)]);
  if (r.status !== 0) throw new Error(`seed-fx ${date} failed`);
}

export interface RecordOptions {
  kind?: "captured" | "uncaptured";
  cli?: string;
  session?: string;
  idemKey?: string;
  projectRoot?: string;
  requestInstant?: string;
  captureInstant?: string;
  fidelity?: string;
  modelId?: string;
  netInput?: number;
  cacheRead?: number;
  cacheWrite?: number | Record<string, number>;
  output?: number;
  reasoning?: number;
  uncapturedReason?: string;
}

/** recordId = sha256(sessionId + U+001F + idempotencyKey), per docs/usage-record-format.md. */
export function makeRecord(o: RecordOptions = {}): Record<string, unknown> {
  const kind = o.kind ?? "captured";
  const session = o.session ?? "test-session";
  const idemKey = o.idemKey ?? "test-idem-key";
  const requestInstant = o.requestInstant ?? new Date().toISOString();
  const record: Record<string, unknown> = {
    schemaVersion: "1.0.0",
    kind,
    fidelity: o.fidelity ?? "per-request",
    recordId: createHash("sha256").update(`${session}\x1F${idemKey}`).digest("hex"),
    idempotencyKey: idemKey,
    provenance: {
      cli: o.cli ?? "claude-code",
      cliVersion: "1.0.0",
      captureChannel: "test-fixture",
      formatFingerprint: `sha256:${"0".repeat(32)}`,
    },
    identity: {
      sessionId: session,
      parentSessionId: null,
      agentId: null,
      projectRoot: o.projectRoot ?? "/home/agent/workspaces/crewrig",
    },
    timing: { requestInstant, captureInstant: o.captureInstant ?? requestInstant },
  };
  if (kind === "captured") {
    record["modelId"] = o.modelId ?? "claude-sonnet-5";
    record["interaction"] = "user-turn";
    record["tokens"] = {
      netInput: o.netInput ?? 100,
      cacheRead: o.cacheRead ?? 0,
      cacheWrite: o.cacheWrite ?? 0,
      output: o.output ?? 50,
      reasoning: o.reasoning ?? 0,
    };
    record["raw"] = { vendor: "test-fixture", usage: {} };
    record["rawStatus"] = "complete";
  } else {
    record["uncapturedReason"] = o.uncapturedReason ?? "test-fixture uncaptured reason";
  }
  return record;
}

/** Write `value` as JSON under the case and return the file path. */
export function writeJson(c: Case, name: string, value: unknown): string {
  const file = path.join(c.root, "..", name);
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}

export function approx(a: number, b: number, eps = 1e-12): boolean {
  return Math.abs(a - b) < eps;
}

// --- HOME safety (spec 0216): the suite never writes under the real usage root ----

const HOME_ABSENT = "<absent>";

function listFiles(root: string): string[] {
  const out: string[] = [];
  const pending = [root];
  for (let dir = pending.pop(); dir !== undefined; dir = pending.pop()) {
    for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, name.name);
      if (name.isDirectory()) pending.push(full);
      else if (name.isFile()) out.push(full);
    }
  }
  return out;
}

/** Sorted file list of `<home>/.crewrig/usage`, or the `<absent>` marker. Throws if unreadable. */
export function homeUsageMarker(home: string = os.userInfo().homedir): string[] {
  const dir = path.join(home, ".crewrig", "usage");
  if (!fs.existsSync(dir)) return [HOME_ABSENT];
  fs.accessSync(dir, fs.constants.R_OK);
  return listFiles(dir).sort();
}

/**
 * Offenders between two markers: a removed file is excused only as a pending to
 * mirrored promotion (same basename now under mirrored/); an added file is an offender
 * when its basename is a sha256 recordId (what the suite itself would produce).
 */
export function homeLeaks(before: readonly string[], after: readonly string[]): string[] {
  const b = new Set(before);
  const a = new Set(after);
  const leaks: string[] = [];
  for (const f of before) {
    if (a.has(f)) continue;
    const base = path.basename(f);
    const promoted = after.some((g) => path.basename(g) === base && g.includes("mirrored"));
    if (!promoted && f !== HOME_ABSENT) leaks.push(`removed: ${f}`);
  }
  for (const f of after) {
    if (b.has(f) || f === HOME_ABSENT) continue;
    if (/^[0-9a-f]{64}(\.[a-z]+)*$/.test(path.basename(f))) leaks.push(`added: ${f}`);
  }
  return leaks;
}

/** True when a child run left nothing under `<scratchHome>/.crewrig/usage`. */
export function scratchHomeUntouched(c: Case): boolean {
  return !fs.existsSync(path.join(c.home, ".crewrig", "usage"));
}

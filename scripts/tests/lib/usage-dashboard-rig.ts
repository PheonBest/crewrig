// usage-dashboard-rig.ts — fixtures of the usage dashboard suites (spec 0210 R26-R30, replacing the
// Bash suite test-usage-dashboard.sh): a golden usage root seeded once per process in a child node (the
// lib JS reads CREWRIG_USAGE_ROOT per call), a fresh copy per case, the environment of every child
// (offline, a temp HOME, no CI, loopback proxy bypass) and runners for the TypeScript entries. REPO
// honours USAGE_DASHBOARD_REPO so a mutated copy can be put under test (13.20).

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { extractEmbedded } from "./usage-dashboard-checks.ts";
import { parseView, type View } from "./usage-dashboard-views.ts";
import { cleanEnv, realTmp, REPO as CHECKOUT, type Result } from "./worktree-fixtures.ts";

export const REPO = process.env["USAGE_DASHBOARD_REPO"] ?? CHECKOUT;
export const FIXTURES = path.join(CHECKOUT, "scripts", "tests", "fixtures", "usage-dashboard");
export const PRICING = path.join(CHECKOUT, "scripts", "tests", "fixtures", "usage-pricing");
const EXPECTED: unknown = JSON.parse(fs.readFileSync(path.join(FIXTURES, "expected.json"), "utf8"));

/** A hand-derived figure of expected.json by key path, e.g. `expected("gapsScope", "amountUsd")`. */
export function expected(...keys: string[]): number {
  let cur: unknown = EXPECTED;
  for (const k of keys)
    cur = typeof cur === "object" && cur !== null ? (cur as Record<string, unknown>)[k] : undefined;
  if (typeof cur !== "number") throw new Error(`expected.json has no number at ${keys.join(".")}`);
  return cur;
}

const FLAG = "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON";
export const NODE_FLAGS = ["--disable-warning=ExperimentalWarning"];

export interface Sandbox {
  readonly root: string;
  readonly home: string;
  readonly env: NodeJS.ProcessEnv;
}

/** The environment of a case: offline, capture-test, no mirror, the case root, a temp HOME. */
export function caseEnv(
  root: string,
  home: string,
  extra: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  return cleanEnv({
    CREWRIG_USAGE_OFFLINE: "1",
    CREWRIG_USAGE_CAPTURE_TEST: "1",
    CREWRIG_USAGE_MIRROR: "0",
    CREWRIG_USAGE_ROOT: root,
    CREWRIG_USAGE_WING: undefined,
    CREWRIG_USAGE_ALLOW_PRUNED: undefined,
    MEMPALACE_PALACE_PATH: path.join(home, "palace"),
    HOME: home,
    USERPROFILE: home,
    CI: undefined,
    HTTP_PROXY: undefined,
    HTTPS_PROXY: undefined,
    http_proxy: undefined,
    https_proxy: undefined,
    NO_PROXY: "127.0.0.1,localhost",
    ...extra,
  });
}

// The seeding and lookup commands of the former embedded driver that need the lib JS (CommonJS).
const DRIVER = String.raw`
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const REPO = process.env.USAGE_TEST_REPO_DIR;
const req = (r) => require(path.join(REPO, r));
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const jsons = (d) => fs.readdirSync(d).filter((n) => n.endsWith('.json')).sort();
function pin(dir) {
  const layout = req('scripts/lib/usage-store/layout.js');
  const blob = readJson(path.join(dir, 'pricelist', 'fixture.json'));
  const pointer = readJson(path.join(dir, 'pricelist', 'PINNED.json'));
  fs.mkdirSync(layout.pricelistDir(), { recursive: true });
  fs.writeFileSync(path.join(layout.pricelistDir(), pointer.sha + '.json'), JSON.stringify(blob));
  fs.writeFileSync(layout.pinnedPointer(), JSON.stringify(pointer, null, 2));
}
function seedFx(dir) {
  const layout = req('scripts/lib/usage-store/layout.js');
  const out = path.join(layout.fxDir(), 'ecb');
  fs.mkdirSync(out, { recursive: true });
  for (const n of fs.readdirSync(path.join(dir, 'fx')).sort()) {
    const fixing = readJson(path.join(dir, 'fx', n));
    fs.writeFileSync(path.join(out, fixing.date + '.json'), JSON.stringify(fixing));
  }
}
function writeFile(f) {
  const result = req('scripts/lib/usage-store/journal.js').write(readJson(f));
  if (result.status !== 'stored') throw new Error('seed: ' + f + ' -> ' + JSON.stringify(result));
}
function visit(d, fn) {
  if (!fs.existsSync(d)) return;
  for (const n of fs.readdirSync(d)) {
    const full = path.join(d, n);
    if (fs.statSync(full).isDirectory()) visit(full, fn); else fn(n, full);
  }
}
const cmds = {
  seed(fx, pr) { pin(pr); seedFx(pr); for (const n of jsons(path.join(fx, 'records'))) writeFile(path.join(fx, 'records', n)); },
  async 'prime-usd'(dir) {
    const store = req('scripts/lib/usage-price/store.js');
    for (const n of jsons(dir)) await store.priceRecord(readJson(path.join(dir, n)), { currency: 'USD' });
  },
  'pin-only': pin, 'seed-fx': seedFx, 'write-one': writeFile,
  'write-dir'(dir) { for (const n of jsons(dir)) writeFile(path.join(dir, n)); },
  async rollup0209(taskKey, currency) {
    const r = await req('scripts/lib/usage-price/rollup.js').rollup({ taskKey }, { store: false, combined: true, currency: currency || 'USD' });
    console.log(JSON.stringify(r));
  },
  'stored-amount'(root, id) {
    let found = null;
    visit(path.join(root, 'prices'), (n, full) => { if (n === id + '.price.json') found = readJson(full); });
    console.log(found ? JSON.stringify({ amount: found.amount, currency: found.currency, status: found.conversion && found.conversion.status }) : 'null');
  },
  'stored-computed-max'(root) {
    let max = '';
    visit(path.join(root, 'prices'), (n, full) => { if (n.endsWith('.price.json') && readJson(full).computedAt > max) max = readJson(full).computedAt; });
    console.log(max);
  },
  'clone-record'(src, dst, key, at) {
    const r = readJson(src);
    r.idempotencyKey = key;
    r.recordId = crypto.createHash('sha256').update(r.identity.sessionId + '\x1F' + key).digest('hex');
    r.timing.requestInstant = at; r.timing.captureInstant = at;
    fs.writeFileSync(dst, JSON.stringify(r));
  },
};
Promise.resolve(cmds[process.argv[1]](...process.argv.slice(2))).catch((e) => { console.log('DRIVER-ERROR ' + (e && e.stack || e)); process.exit(1); });
`;

/** Run one driver command against `REPO` with the case environment; throws on a non-zero exit. */
export function drv(cmd: string, args: readonly string[], env: NodeJS.ProcessEnv): string {
  const r = spawnSync(process.execPath, [...NODE_FLAGS, "-e", DRIVER, cmd, ...args], {
    encoding: "utf8",
    env: { ...env, USAGE_TEST_REPO_DIR: REPO },
  });
  if (r.status !== 0) throw new Error(`driver ${cmd} failed: ${r.stdout}${r.stderr}`.slice(0, 600));
  return r.stdout;
}

/** Spawn a TypeScript entry (`usage-dashboard`, `usage-price`, ...) of the tree under test. */
export function runEntry(
  name: string,
  args: readonly string[],
  sb: Sandbox,
  timeout = 60000,
): Result {
  const r = spawnSync(process.execPath, [FLAG, path.join(REPO, "scripts", `${name}.ts`), ...args], {
    encoding: "utf8",
    env: sb.env,
    timeout,
    cwd: REPO,
  });
  return { status: r.status, signal: r.signal, stdout: r.stdout, stderr: r.stderr };
}
export const dash = (args: readonly string[], sb: Sandbox): Result =>
  runEntry("usage-dashboard", args, sb);

let golden: string | undefined;
/** The seeded golden root: pin, FX fixings, 20 records, one ledger entry, a primed USD price store. */
export function goldenRoot(): string {
  if (golden !== undefined) return golden;
  const root = realTmp("ud-golden-");
  const home = realTmp("ud-golden-home-");
  const env = caseEnv(root, home);
  drv("seed", [FIXTURES, PRICING], env);
  const attr = runEntry(
    "usage-attribute",
    [
      "add",
      "--period",
      "2026-11",
      "--task-key",
      "task-split-b",
      "--reason",
      "usage-dashboard suite: a ledger {period} entry splits sess-split across two task keys",
      "--author",
      "test-suite",
    ],
    { root, home, env },
  );
  if (attr.status !== 0)
    throw new Error(`usage-attribute add failed: ${attr.stderr}`.slice(0, 400));
  drv("prime-usd", [path.join(FIXTURES, "records")], env);
  golden = root;
  return root;
}

/** A fresh sandbox: a copy of the golden root (or an empty root) and its own temp HOME. */
export function freshSandbox(kind: "golden" | "empty" = "golden"): Sandbox {
  const root = realTmp("ud-root-");
  const home = realTmp("ud-home-");
  if (kind === "golden") fs.cpSync(goldenRoot(), root, { recursive: true });
  return { root, home, env: caseEnv(root, home) };
}

/** Sorted sha256 manifest of every file under `root` (the read-only proof). */
export function manifest(root: string): string {
  const out: string[] = [];
  const visit = (d: string): void => {
    for (const n of fs.readdirSync(d).sort()) {
      const full = path.join(d, n);
      if (fs.lstatSync(full).isDirectory()) visit(full);
      else
        out.push(
          `${createHash("sha256").update(fs.readFileSync(full)).digest("hex")}  ${path.relative(root, full)}`,
        );
    }
  };
  if (fs.existsSync(root)) visit(root);
  return out.join("\n");
}

/** The files under `<home>/.crewrig/usage` (the HOME marker): empty for a temp HOME that stayed clean. */
export function homeMarker(home: string): string[] {
  const out: string[] = [];
  const visit = (d: string): void => {
    for (const n of fs.existsSync(d) ? fs.readdirSync(d) : []) {
      const full = path.join(d, n);
      if (fs.lstatSync(full).isDirectory()) visit(full);
      else out.push(full);
    }
  };
  visit(path.join(home, ".crewrig", "usage"));
  return out.sort();
}

export const readText = (f: string): string => fs.readFileSync(f, "utf8");

export interface Forms {
  readonly A?: View;
  readonly C?: View;
  readonly Ctext: string;
  readonly Ahtml: string;
  readonly errors: string[];
}
/** Forms A (page, embedded JSON) and C (`report --json` and the text report) of one selection. */
export function threeForms(
  sb: Sandbox,
  dir: string,
  label: string,
  filters: readonly string[],
): Forms {
  const errors: string[] = [];
  const page = path.join(dir, `${label}.A.html`);
  const a = dash(["page", "--out", page, ...filters], sb);
  const c = dash(["report", "--json", ...filters], sb);
  const t = dash(["report", ...filters], sb);
  let A: View | undefined;
  let C: View | undefined;
  try {
    A = extractEmbedded(readText(page));
  } catch (e) {
    errors.push(`A: ${String(e)} ${a.stderr.slice(0, 200)}`);
  }
  try {
    C = parseView(c.stdout);
  } catch {
    errors.push(`C: ${c.stderr.slice(0, 200)}`);
  }
  const Ahtml = fs.existsSync(page) ? readText(page) : "";
  return { ...(A ? { A } : {}), ...(C ? { C } : {}), Ctext: t.stdout, Ahtml, errors };
}

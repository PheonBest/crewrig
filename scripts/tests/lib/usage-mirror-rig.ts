// usage-mirror-rig.ts — shared rig of the fake-daemon suites of the usage-record
// mirror path (spec 0260, port of scripts/tests/test-usage-storage-mirror.sh).
//
// One rig = one fake MemPalace daemon (fixtures/usage-storage/fake-mempalace-mcp.js,
// kept as JavaScript) on an ephemeral port (never 41893), one USAGE_ROOT, one palace
// path (hence one token hash) and one scratch HOME/USERPROFILE: the Bash suite wrote
// its token file under the REAL home, this rig never does. The rig sets the
// process environment of the test process itself (journal.js is driven in-process),
// so a test file creates exactly one rig and its tests run one after the other.
// POSIX-only: the write-time detached spawn is `bash usage-mirror.sh --from-write`.

import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { REPO, realTmp, WINDOWS } from "./worktree-fixtures.ts";
import { type RecordOpts, makeRecord } from "./usage-mirror-records.ts";

export { makeRecord, type RecordOpts };

const require = createRequire(import.meta.url);
const FIXTURE = path.join(REPO, "scripts/tests/fixtures/usage-storage/fake-mempalace-mcp.js");
export const SUITE_WING = "usage-storage-mirror-suite";
export const SKIP_REASON = WINDOWS
  ? "SKIP: POSIX-only (detached bash spawn, bash shims, lock mtime)"
  : false;

export interface Rig {
  readonly root: string;
  readonly home: string;
  readonly helpers: string;
  port: number;
  readonly token: string;
  readonly log: string;
  readonly drawersFile: string;
  fake: ChildProcess | undefined;
}

export interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const a = srv.address();
      const port = typeof a === "object" && a !== null ? a.port : 0;
      srv.close(() => (port === 0 ? reject(new Error("no ephemeral port")) : resolve(port)));
    });
  });
}

export function waitFor(cond: () => boolean, tries = 50, stepMs = 100): Promise<boolean> {
  return new Promise((resolve) => {
    let n = 0;
    const tick = (): void => {
      if (cond()) return resolve(true);
      if (++n >= tries) return resolve(cond());
      setTimeout(tick, stepMs);
    };
    tick();
  });
}

/** Env of a child: the rig's, minus CI and proxies, with node's own directory first on PATH. */
export function childEnv(
  rig: Rig,
  extra: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of Object.keys(env)) {
    if (/^(CI|(http|https|all|no)_proxy)$/i.test(k)) delete env[k];
  }
  env.NO_PROXY = "127.0.0.1,localhost";
  env.PATH = `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ""}`;
  Object.assign(env, { HOME: rig.home, USERPROFILE: rig.home });
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return env;
}

/** Create a rig and point THIS process's environment at it (journal.js runs in-process). */
export function createRig(prefix: string): Rig {
  const base = realTmp(`${prefix}-`);
  const home = path.join(base, "home");
  const root = path.join(base, "usage");
  const helpers = path.join(base, "helpers");
  for (const d of [home, root, helpers, path.join(base, "palace-parent")]) {
    fs.mkdirSync(d, { recursive: true });
  }
  const rig: Rig = {
    root,
    home,
    helpers,
    port: 0,
    token: `fake-mempalace-token-${randomBytes(6).toString("hex")}`,
    log: path.join(helpers, "fake-calls.jsonl"),
    drawersFile: path.join(helpers, "fake-drawers.json"),
    fake: undefined,
  };
  fs.writeFileSync(rig.log, "");
  fs.writeFileSync(rig.drawersFile, "{}");
  Object.assign(process.env, {
    HOME: home,
    USERPROFILE: home,
    CREWRIG_USAGE_ROOT: root,
    MEMPALACE_PALACE_PATH: path.join(base, "palace-parent", "palace"),
    CREWRIG_USAGE_WING: SUITE_WING,
    PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ""}`,
  });
  for (const k of ["CREWRIG_USAGE_MIRROR", "CREWRIG_USAGE_ALLOW_PRUNED", "CI"])
    delete process.env[k];
  return rig;
}

/** Pick the port and install the token file at the derived (scratch-home) path. */
export async function openRig(rig: Rig): Promise<Rig> {
  const open = rig;
  open.port = await freePort();
  if (open.port === 41893) throw new Error("refusing the real daemon's port");
  process.env.MEMPALACE_MCP_PORT = String(open.port);
  const tokenPath = (
    require(path.join(REPO, "scripts/lib/usage-store/mcp.js")) as { tokenPath(): string }
  ).tokenPath();
  if (!tokenPath.startsWith(rig.home))
    throw new Error(`token path ${tokenPath} escapes the scratch home`);
  fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
  fs.writeFileSync(tokenPath, open.token);
  return open;
}

export async function startFake(rig: Rig): Promise<void> {
  rig.fake = spawn(
    process.execPath,
    [FIXTURE, String(rig.port), rig.token, rig.log, rig.drawersFile],
    { stdio: "ignore" },
  );
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${rig.port}/healthz`)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`fake daemon did not bind port ${rig.port} within 5s`);
}

export async function stopFake(rig: Rig): Promise<void> {
  const f = rig.fake;
  rig.fake = undefined;
  if (f === undefined || f.exitCode !== null) return;
  const done = new Promise((r) => f.once("exit", r));
  f.kill();
  await done;
}

export async function control(rig: Rig, body: unknown): Promise<void> {
  const res = await fetch(`http://127.0.0.1:${rig.port}/control`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`control ${JSON.stringify(body)} -> ${res.status}`);
}
export const toolFailure = (rig: Rig, tool: string, shape: string | null): Promise<void> =>
  control(rig, { toolFailure: { tool, shape } });
export const jsonrpcError = (rig: Rig, tool: string, code: number): Promise<void> =>
  control(rig, { toolFailure: { tool, shape: "jsonrpc-error", code } });
export const sourceToolFailure = (
  rig: Rig,
  tool: string,
  shape: string,
  recordIds: string[],
): Promise<void> => control(rig, { sourceToolFailure: { tool, shape, recordIds } });
export const clearSourceToolFailure = (rig: Rig): Promise<void> =>
  control(rig, { sourceToolFailure: null });

export function logLines(rig: Rig): string[] {
  return fs
    .readFileSync(rig.log, "utf8")
    .split("\n")
    .filter((l) => l !== "");
}
/** Calls of one tool in the fake's log (the Bash `grep -cF '"tool":"<name>"'`). */
export const callCount = (rig: Rig, tool: string): number =>
  logLines(rig).filter((l) => l.includes(`"tool":"${tool}"`)).length;

export interface Drawer {
  wing: string;
  added_by: string;
  source_file: string;
  content: string;
}
export function drawers(rig: Rig): Record<string, Drawer> {
  return JSON.parse(fs.readFileSync(rig.drawersFile, "utf8")) as Record<string, Drawer>;
}
export const drawerCount = (rig: Rig): number => Object.keys(drawers(rig)).length;
export const drawersForSource = (rig: Rig, source: string): Drawer[] =>
  Object.values(drawers(rig)).filter((d) => d.source_file === source);

/** Journal one record in-process; `spawnMirror` false sets CREWRIG_USAGE_MIRROR=0 (no detached child). */
export function writeRecord(o: RecordOpts, spawnMirror = false): string {
  const record = makeRecord(o);
  const journal = require(path.join(REPO, "scripts/lib/usage-store/journal.js")) as {
    write(r: unknown): { status: string; reason?: string };
  };
  const before = process.env.CREWRIG_USAGE_MIRROR;
  if (!spawnMirror) process.env.CREWRIG_USAGE_MIRROR = "0";
  try {
    const res = journal.write(record);
    if (res.status !== "stored")
      throw new Error(`journal write: ${res.status} ${res.reason ?? ""}`);
  } finally {
    if (before === undefined) delete process.env.CREWRIG_USAGE_MIRROR;
    else process.env.CREWRIG_USAGE_MIRROR = before;
  }
  return record.recordId as string;
}

// Path algebra (layout.js)
export const entryPath = (rig: Rig, cli: string, per: string, rid: string): string =>
  path.join(rig.root, "journal", cli, per, `${rid}.json`);
export const sidecarPath = (rig: Rig, cli: string, per: string, rid: string): string =>
  path.join(rig.root, "journal", cli, per, `${rid}.wing.json`);
export const pendingPath = (rig: Rig, cli: string, per: string, rid: string): string =>
  path.join(rig.root, "mirror/pending", cli, per, rid);
export const mirroredPath = (rig: Rig, cli: string, per: string, rid: string): string =>
  path.join(rig.root, "mirror/mirrored", cli, per, rid);
export function pendingCount(rig: Rig): number {
  const dir = path.join(rig.root, "mirror/pending");
  if (!fs.existsSync(dir)) return 0;
  return (fs.readdirSync(dir, { recursive: true, withFileTypes: true }) as fs.Dirent[]).filter(
    (e) => e.isFile(),
  ).length;
}
export function setMarkerMtime(file: string, epochMs: number): void {
  const t = new Date(epochMs);
  fs.utimesSync(file, t, t);
}

/** `bash <repo>/scripts/<name>.sh args` (a shim), synchronously. */
export function runShim(
  rig: Rig,
  name: "usage-mirror" | "usage-prune",
  args: string[] = [],
  extra: Record<string, string | undefined> = {},
  repo = REPO,
): Run {
  const r = spawnSync("bash", [path.join(repo, "scripts", `${name}.sh`), ...args], {
    env: childEnv(rig, extra),
    encoding: "utf8",
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** Same, asynchronously: the caller's own timers keep running (lock-race case). */
export function spawnShim(
  rig: Rig,
  name: "usage-mirror" | "usage-prune",
  args: string[] = [],
  extra: Record<string, string | undefined> = {},
  repo = REPO,
): Promise<Run> {
  return new Promise((resolve) => {
    const c = spawn("bash", [path.join(repo, "scripts", `${name}.sh`), ...args], {
      env: childEnv(rig, extra),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    c.stdout.on("data", (d) => (stdout += d));
    c.stderr.on("data", (d) => (stderr += d));
    c.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

/** Wait until no detached catch-up child holds `locks/mirror.lock` (it may still be starting). */
export async function quiesce(rig: Rig): Promise<void> {
  const lock = path.join(rig.root, "locks", "mirror.lock");
  await new Promise((r) => setTimeout(r, 300));
  await waitFor(() => !fs.existsSync(lock), 100, 100);
}

export async function closeRig(rig: Rig): Promise<void> {
  await stopFake(rig);
  await quiesce(rig);
  fs.rmSync(path.dirname(rig.root), { recursive: true, force: true });
}

// usage-storage-rig.ts — the shared sandbox of the usage-storage suites (spec 0260,
// replaces the Bash sandbox, make-record and path algebra of test-usage-storage.sh).
//
// A sandbox owns a temp usage root, a palace path and a TEMP HOME: mcp.js derives the
// token path from os.homedir(), which honours HOME on POSIX and USERPROFILE on Windows,
// so no case ever writes under the real home. Every write runs in a fresh child
// (usage-storage-driver.ts) because journal.js reads its environment at require time.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cleanEnv, realTmp, REPO } from "./worktree-fixtures.ts";

export const DRIVER = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "usage-storage-driver.ts",
);
const NODE_ARGS = [
  "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
  "--disable-warning=ExperimentalWarning",
];
const STRIPPED = [
  "CREWRIG_USAGE_WING",
  "CREWRIG_USAGE_ALLOW_PRUNED",
  "CREWRIG_USAGE_DRAIN_BUDGET_MS",
  "CREWRIG_USAGE_DRAIN_LOCK_STALE_MS",
  "CREWRIG_USAGE_TMP_STALE_MS",
  "CI",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "http_proxy",
  "https_proxy",
];

export interface Sandbox {
  readonly root: string;
  readonly palace: string;
  readonly home: string;
  /** Tree whose usage-store modules the driver loads (the repository unless mutated). */
  repo: string;
  env(extra?: Record<string, string | undefined>): NodeJS.ProcessEnv;
  cleanup(): void;
}

export function sandbox(repo: string = REPO): Sandbox {
  const root = realTmp("usage-root-");
  const parent = realTmp("usage-palace-");
  const home = realTmp("usage-home-");
  const sb: Sandbox = {
    root,
    palace: path.join(parent, "palace"),
    home,
    repo,
    env(extra = {}) {
      const base: Record<string, string | undefined> = {
        CREWRIG_USAGE_ROOT: root,
        MEMPALACE_PALACE_PATH: path.join(parent, "palace"),
        CREWRIG_USAGE_MIRROR: "0",
        HOME: home,
        USERPROFILE: home,
        NO_PROXY: "127.0.0.1,localhost",
        USAGE_TEST_REPO_DIR: sb.repo,
      };
      for (const k of STRIPPED) base[k] = undefined;
      return cleanEnv({ ...base, ...extra });
    },
    cleanup() {
      for (const d of [root, parent, home]) fs.rmSync(d, { recursive: true, force: true });
    },
  };
  return sb;
}

export interface Drive {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** The `STATUS=` line value, or "". */
  readonly state: string;
  readonly reason: string;
}

function toDrive(status: number | null, stdout: string, stderr: string): Drive {
  return {
    status,
    stdout,
    stderr,
    state: /^STATUS=(.*)$/m.exec(stdout)?.[1] ?? "",
    reason: /^REASON=(.*)$/m.exec(stdout)?.[1] ?? "",
  };
}

/** Run one driver command in a fresh child. */
export function drive(
  sb: Sandbox,
  args: readonly string[],
  extra: Record<string, string | undefined> = {},
  cwd?: string,
): Drive {
  const r = spawnSync(process.execPath, [...NODE_ARGS, DRIVER, ...args], {
    encoding: "utf8",
    env: sb.env(extra),
    cwd,
    timeout: 60_000,
  });
  return toDrive(r.status, r.stdout ?? "", r.stderr ?? "");
}

/** Same as `drive`, asynchronous, for real process concurrency. */
export function driveAsync(
  sb: Sandbox,
  args: readonly string[],
  extra: Record<string, string | undefined> = {},
): Promise<Drive> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [...NODE_ARGS, DRIVER, ...args], { env: sb.env(extra) });
    let out = "";
    let err = "";
    child.stdout.on("data", (x) => (out += x));
    child.stderr.on("data", (x) => (err += x));
    child.on("close", (code) => resolve(toDrive(code, out, err)));
  });
}

export interface UsageRecord {
  recordId: string;
  provenance: { cli: string; [key: string]: unknown };
  timing: { requestInstant: string; [key: string]: unknown };
  attribution?: { taskHandoffKey?: string; externalAsset?: { kind: string; ref: string } };
  [key: string]: unknown;
}

export function readRecord(file: string): UsageRecord {
  return JSON.parse(fs.readFileSync(file, "utf8")) as UsageRecord;
}

export interface RecordOptions {
  kind?: "captured" | "uncaptured";
  cli?: string;
  session?: string;
  idem?: string;
  projectRoot?: string;
  requestInstant?: string;
  fidelity?: string;
  parentSession?: string;
  agentId?: string;
  corrects?: string;
  taskKey?: string;
  asset?: { kind: string; ref: string };
}

export function deriveRecordId(session: string, idem: string): string {
  return createHash("sha256").update(`${session}\x1F${idem}`).digest("hex");
}

/** Port of make-record: recordId is always derived honestly. */
export function makeRecord(o: RecordOptions = {}): UsageRecord {
  const kind = o.kind ?? "captured";
  const session = o.session ?? "test-session";
  const idem = o.idem ?? "test-idem-key";
  const requestInstant = o.requestInstant ?? new Date().toISOString();
  const rec: UsageRecord = {
    schemaVersion: "1.0.0",
    kind,
    fidelity: o.fidelity ?? "per-request",
    recordId: deriveRecordId(session, idem),
    idempotencyKey: idem,
    provenance: {
      cli: o.cli ?? "claude-code",
      cliVersion: "1.0.0",
      captureChannel: "test-fixture",
      formatFingerprint: `sha256:${"0".repeat(32)}`,
    },
    identity: {
      sessionId: session,
      parentSessionId: o.parentSession ?? null,
      agentId: o.agentId ?? null,
      projectRoot: o.projectRoot ?? "/home/agent/workspaces/crewrig",
    },
    timing: { requestInstant, captureInstant: requestInstant },
  };
  if (o.corrects !== undefined) rec.corrects = o.corrects;
  if (kind === "captured") {
    rec.modelId = "claude-sonnet-5";
    rec.interaction = "user-turn";
    rec.tokens = { netInput: 100, cacheRead: 0, cacheWrite: 0, output: 50, reasoning: 0 };
    rec.raw = { vendor: "test-fixture", usage: { input_tokens: 100, output_tokens: 50 } };
    rec.rawStatus = "complete";
  } else {
    rec.uncapturedReason = "test-fixture uncaptured reason";
  }
  if (o.taskKey !== undefined || o.asset !== undefined) {
    rec.attribution = {};
    if (o.taskKey !== undefined) rec.attribution.taskHandoffKey = o.taskKey;
    if (o.asset !== undefined) rec.attribution.externalAsset = o.asset;
  }
  return rec;
}

export function periodOf(rec: UsageRecord): string {
  const d = new Date(rec.timing.requestInstant);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Write a record (object, or a file path) through a fresh driver child. */
export function writeRecord(
  sb: Sandbox,
  rec: UsageRecord | string,
  extra: Record<string, string | undefined> = {},
): Drive {
  return drive(sb, ["write", materialize(sb, rec)], extra);
}

export function writeRecordAsync(sb: Sandbox, rec: UsageRecord | string): Promise<Drive> {
  return driveAsync(sb, ["write", materialize(sb, rec)]);
}

let counter = 0;
function materialize(sb: Sandbox, rec: UsageRecord | string): string {
  if (typeof rec === "string") return rec;
  const dir = path.join(sb.home, "inputs");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `rec-${process.pid}-${counter++}.json`);
  fs.writeFileSync(file, JSON.stringify(rec));
  return file;
}

// --- path algebra (read-only mirrors of layout.js joins) ---------------------
export const entryPath = (sb: Sandbox, cli: string, per: string, rid: string): string =>
  path.join(sb.root, "journal", cli, per, `${rid}.json`);
export const sidecarPath = (sb: Sandbox, cli: string, per: string, rid: string): string =>
  path.join(sb.root, "journal", cli, per, `${rid}.wing.json`);
export const partitionDir = (sb: Sandbox, cli: string, per: string): string =>
  path.join(sb.root, "journal", cli, per);
export const pendingMarker = (sb: Sandbox, cli: string, per: string, rid: string): string =>
  path.join(sb.root, "mirror", "pending", cli, per, rid);
export const prunedMarker = (sb: Sandbox, cli: string, per: string): string =>
  path.join(sb.root, "pruned", cli, `${per}.json`);
export const drainLock = (sb: Sandbox): string => path.join(sb.root, "locks", "drain.lock");

/** Count regular files under `dir` (recursively); 0 when it does not exist. */
export function countFiles(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    n += e.isDirectory() ? countFiles(path.join(dir, e.name)) : 1;
  }
  return n;
}

export function backdate(file: string, deltaMs: number): void {
  const past = new Date(Date.now() - deltaMs);
  fs.utimesSync(file, past, past);
}

/** `usage-query` through the real entry (or `entry`, e.g. a mutated copy's query.js). */
export function query(sb: Sandbox, args: readonly string[], entry?: string) {
  const file = entry ?? path.join(sb.repo, "scripts", "usage-query.ts");
  const r = spawnSync(process.execPath, [...NODE_ARGS, file, ...args], {
    encoding: "utf8",
    env: sb.env(),
    timeout: 60_000,
  });
  const ids = (r.stdout ?? "")
    .split("\n")
    .filter((l) => l.trim() !== "" && l.trim().startsWith("{"))
    .map((l) => JSON.parse(l) as UsageRecord);
  return {
    status: r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    lines: ids,
    ids: ids.map((x) => x.recordId).sort(),
  };
}

/** `usage-prune` through the real entry. */
export function prune(sb: Sandbox, args: readonly string[]) {
  const r = spawnSync(
    process.execPath,
    [...NODE_ARGS, path.join(sb.repo, "scripts", "usage-prune.ts"), ...args],
    {
      encoding: "utf8",
      env: sb.env(),
      timeout: 60_000,
    },
  );
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

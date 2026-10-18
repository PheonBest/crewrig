// usage-mirror-spawn.test.ts — spec 0253 delta-04 (requirements 23, 30, 31; #1515): the
// write-time detached mirror spawn runs `process.execPath` on scripts/usage-mirror.ts,
// needs no `bash`, and a failed spawn never changes the outcome of the write.
//
// No shell of any kind, nothing skipped on win32 (the `windows-usage-wrappers` job runs
// this file under PowerShell). Isolation: scratch HOME, USERPROFILE and
// CREWRIG_USAGE_ROOT (usage-storage-rig sandbox), a PATH holding only the directory of
// `process.execPath`, CREWRIG_USAGE_MIRROR unset. The spawn is observed by
// `NODE_OPTIONS=--require` preload stubs written into the scratch dir: production code
// carries no test seam. Nothing real is mirrored: the stub exits before the entry runs.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import {
  countFiles,
  drive,
  makeRecord,
  periodOf,
  pendingMarker,
  sandbox,
  writeRecord,
  type Sandbox,
} from "./lib/usage-storage-rig.ts";
import { REPO } from "./lib/worktree-fixtures.ts";

const boxes: Sandbox[] = [];
const fresh = (): Sandbox => {
  const sb = sandbox();
  boxes.push(sb);
  return sb;
};
after(() => {
  for (const sb of boxes) sb.cleanup();
});

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function waitFor(file: string, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fs.existsSync(file)) return true;
    await sleep(100);
  }
  return fs.existsSync(file);
}

const slash = (p: string): string => p.replace(/\\/g, "/");

/** Preload recording the argv of the detached `--from-write` child, then exiting 0. */
function recorderPreload(sb: Sandbox): { sentinel: string; preload: string } {
  const sentinel = path.join(sb.home, "spawn-record.json");
  const preload = path.join(sb.home, "record-spawn.cjs");
  fs.writeFileSync(
    preload,
    `const fs = require('fs');
if (process.argv.includes('--from-write')) {
  fs.writeFileSync(${JSON.stringify(sentinel)}, JSON.stringify({ execPath: process.execPath, argv: process.argv }));
  process.exit(0);
}
`,
  );
  return { sentinel, preload };
}

/** Preload for the WRITER process: `mode` makes the mirror spawn fail asynchronously or throw. */
function failingSpawnPreload(sb: Sandbox, mode: "async" | "throw"): string {
  const preload = path.join(sb.home, `fail-spawn-${mode}.cjs`);
  fs.writeFileSync(
    preload,
    `const cp = require('child_process');
const real = cp.spawn;
cp.spawn = function (cmd, args, opts) {
  if (!Array.isArray(args) || !args.includes('--from-write')) return real.apply(this, arguments);
  ${
    mode === "throw"
      ? "throw new TypeError('synthetic synchronous spawn failure');"
      : "return real.call(this, " +
        JSON.stringify(path.join(sb.home, "no-such-executable")) +
        ", args, opts);"
  }
};
`,
  );
  return preload;
}

function placeToken(sb: Sandbox): void {
  const token = drive(sb, ["token-path"]).stdout.trim();
  fs.mkdirSync(path.dirname(token), { recursive: true });
  fs.writeFileSync(token, "test-token-value\n");
}

/** `bash` is not resolvable: PATH is the directory of the running node only. */
const narrowPath = (): string => path.dirname(process.execPath);

function env(preload: string, extra: Record<string, string | undefined> = {}) {
  return {
    PATH: narrowPath(),
    CREWRIG_USAGE_MIRROR: undefined,
    NODE_OPTIONS: `--require ${slash(preload)}`,
    ...extra,
  };
}

const marker = (sb: Sandbox, rec: ReturnType<typeof makeRecord>): string =>
  pendingMarker(sb, "claude-code", periodOf(rec), rec.recordId);

describe("usage mirror detached spawn (spec 0253 delta-04)", () => {
  test("token present, no bash on PATH: spawns node on usage-mirror.ts --from-write", async () => {
    const sb = fresh();
    placeToken(sb);
    const { sentinel, preload } = recorderPreload(sb);
    const rec = makeRecord({ session: "spawn-s1", idem: "spawn-k1" });
    const out = writeRecord(sb, rec, env(preload));
    assert.equal(out.status, 0, out.stderr);
    assert.equal(out.state, "stored", out.stdout);
    assert.ok(fs.existsSync(marker(sb, rec)), "pending marker missing");
    assert.equal(countFiles(path.join(sb.root, "mirror", "pending")), 1);
    assert.equal(await waitFor(sentinel, 10_000), true, "no spawn recorded");
    const seen = JSON.parse(fs.readFileSync(sentinel, "utf8")) as {
      execPath: string;
      argv: string[];
    };
    const real = (p: string): string => fs.realpathSync(path.resolve(p));
    assert.equal(seen.argv.length, 3, JSON.stringify(seen.argv));
    assert.equal(real(seen.argv[0] ?? ""), real(process.execPath));
    assert.equal(real(seen.argv[1] ?? ""), real(path.join(REPO, "scripts", "usage-mirror.ts")));
    assert.equal(seen.argv[2], "--from-write");
  });

  for (const mode of ["async", "throw"] as const) {
    test(`failed spawn (${mode}) never changes the write outcome`, async () => {
      const sb = fresh();
      placeToken(sb);
      const preload = failingSpawnPreload(sb, mode);
      const rec = makeRecord({ session: `fail-${mode}`, idem: `fail-key-${mode}` });
      const out = writeRecord(sb, rec, env(preload));
      await sleep(600);
      assert.equal(out.status, 0, out.stderr);
      assert.equal(out.state, "stored", out.stdout);
      assert.equal(out.stderr, "", "stderr must stay empty");
      assert.ok(fs.existsSync(marker(sb, rec)), "pending marker missing");
    });
  }

  test("gate: no token file => no spawn and no mirror dir", async () => {
    const sb = fresh();
    const { sentinel, preload } = recorderPreload(sb);
    const rec = makeRecord({ session: "gate-s1", idem: "gate-k1" });
    const out = writeRecord(sb, rec, env(preload));
    assert.equal(out.state, "stored", out.stdout);
    await sleep(600);
    assert.equal(fs.existsSync(sentinel), false, "spawned without token");
    assert.equal(fs.existsSync(path.join(sb.root, "mirror")), false, "mirror/ was created");
  });

  test("gate: CREWRIG_USAGE_MIRROR=0 => marker only, no spawn", async () => {
    const sb = fresh();
    placeToken(sb);
    const { sentinel, preload } = recorderPreload(sb);
    const rec = makeRecord({ session: "gate-s2", idem: "gate-k2" });
    const out = writeRecord(sb, rec, env(preload, { CREWRIG_USAGE_MIRROR: "0" }));
    assert.equal(out.state, "stored", out.stdout);
    assert.ok(fs.existsSync(marker(sb, rec)), "pending marker missing");
    await sleep(600);
    assert.equal(fs.existsSync(sentinel), false, "spawned despite CREWRIG_USAGE_MIRROR=0");
  });

  test("gate: fresh unreachable stamp => marker only, no spawn", async () => {
    const sb = fresh();
    placeToken(sb);
    const { sentinel, preload } = recorderPreload(sb);
    const stamp = path.join(sb.root, "mirror", "unreachable.stamp");
    fs.mkdirSync(path.dirname(stamp), { recursive: true });
    fs.writeFileSync(stamp, "");
    const rec = makeRecord({ session: "gate-s3", idem: "gate-k3" });
    const out = writeRecord(sb, rec, env(preload));
    assert.equal(out.state, "stored", out.stdout);
    assert.ok(fs.existsSync(marker(sb, rec)), "pending marker missing");
    await sleep(600);
    assert.equal(fs.existsSync(sentinel), false, "spawned despite a fresh stamp");
  });
});

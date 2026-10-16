// usage-mirror-catchup.test.ts — groups (a), (b), (c) and (f) of the fake-daemon mirror
// suite (port of scripts/tests/test-usage-storage-mirror.sh, spec 0207 R23; spec 0260).
// Each test builds its own rig (own fake daemon, USAGE_ROOT, palace, scratch HOME): no
// state is carried between cases, counts are relative to the case's own start.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { seedOpts } from "./lib/usage-mirror-records.ts";
import {
  callCount,
  closeRig,
  createRig,
  drawerCount,
  drawers,
  drawersForSource,
  entryPath,
  logLines,
  mirroredPath,
  openRig,
  pendingPath,
  quiesce,
  runShim,
  type Rig,
  SKIP_REASON,
  SUITE_WING,
  sidecarPath,
  startFake,
  waitFor,
  writeRecord,
} from "./lib/usage-mirror-rig.ts";

const CLI = "claude-code";
const PERIOD = "2022-11";
const INSTANT = "2022-11-01T00:00:00.000Z";
let searchCalls = 0;

async function withRig(name: string, fn: (rig: Rig) => Promise<void>): Promise<void> {
  const rig = await openRig(createRig(name));
  try {
    await fn(rig);
    searchCalls += rig.fake === undefined ? 0 : callCount(rig, "mempalace_search");
  } finally {
    await closeRig(rig);
  }
}

/** Six records (5 captured + 1 uncaptured), journaled quietly; returns their recordIds. */
function seed6(quiet = true): string[] {
  return seedOpts("down", CLI, INSTANT, 6, true).map((o) => writeRecord(o, !quiet));
}

describe("usage mirror catch-up", { skip: SKIP_REASON }, () => {
  // (a) L439: daemon down, detached spawn enabled
  test("(a) daemon down: stamp, 6 journaled, 6 pending, 0 mirrored", async () => {
    await withRig("mirror-a", async (rig) => {
      const rids = seed6(false);
      const stamp = path.join(rig.root, "mirror", "unreachable.stamp");
      assert.ok(await waitFor(() => fs.existsSync(stamp)), "unreachable.stamp never appeared");
      await quiesce(rig);
      for (const rid of rids) {
        assert.ok(fs.existsSync(entryPath(rig, CLI, PERIOD, rid)), "journal entry missing");
        assert.ok(fs.existsSync(pendingPath(rig, CLI, PERIOD, rid)), "pending marker missing");
        assert.ok(!fs.existsSync(mirroredPath(rig, CLI, PERIOD, rid)), "mirrored despite down");
      }
      assert.equal(rids.length, 6);
    });
  });

  // (b) L490: catch-up mirrors exactly N
  test("(b) catch-up mirrors exactly N=6, slim captured, uncaptured byte-identical, idempotent", async () => {
    await withRig("mirror-b", async (rig) => {
      const rids = seed6();
      await startFake(rig);
      const r = runShim(rig, "usage-mirror");
      assert.equal(r.status, 0);
      assert.equal(callCount(rig, "mempalace_add_drawer"), 6, "exactly 6 add_drawer calls");
      for (const rid of rids) {
        assert.ok(fs.existsSync(mirroredPath(rig, CLI, PERIOD, rid)), "marker not mirrored");
        assert.ok(!fs.existsSync(pendingPath(rig, CLI, PERIOD, rid)), "marker still pending");
      }
      const all = Object.values(drawers(rig));
      assert.equal(all.length, 6);
      assert.deepEqual([...new Set(all.map((d) => d.wing))], [SUITE_WING]);
      assert.deepEqual(
        [...new Set(all.map((d) => d.added_by))],
        ["crewrig-usage-store/env-override"],
      );
      assert.ok(
        all.every((d) => path.isAbsolute(d.source_file)),
        "source_file not absolute",
      );
      for (const rid of rids.slice(0, 5)) {
        const [d] = drawersForSource(rig, entryPath(rig, CLI, PERIOD, rid));
        const c = JSON.parse(d.content) as Record<string, unknown>;
        assert.equal(c.raw, undefined, "raw must be dropped");
        assert.equal(c.rawStatus, "externalized");
        assert.ok(typeof c.rawRef === "string" && c.rawRef.includes(c.recordId as string));
      }
      const uncaptured = entryPath(rig, CLI, PERIOD, rids[5]);
      const [u] = drawersForSource(rig, uncaptured);
      assert.equal(u.content, fs.readFileSync(uncaptured, "utf8"), "byte-identical to the entry");
      const uc = JSON.parse(u.content) as Record<string, unknown>;
      assert.ok(!("rawStatus" in uc) && !("rawRef" in uc));
      runShim(rig, "usage-mirror"); // idempotent: nothing pending adds no call
      assert.equal(callCount(rig, "mempalace_add_drawer"), 6, "second catch-up adds 0 calls");
    });
  });

  // (c) L612: --reconcile is N, not 2N
  test("(c) --reconcile after losing mirror/: N drawers not 2N; no sidecar re-derives the wing", async () => {
    await withRig("mirror-c", async (rig) => {
      const rids = seed6();
      await startFake(rig);
      runShim(rig, "usage-mirror");
      const idsBefore = Object.keys(drawers(rig)).sort();
      const callsBefore = callCount(rig, "mempalace_add_drawer");
      fs.rmSync(path.join(rig.root, "mirror"), { recursive: true, force: true });
      assert.equal(runShim(rig, "usage-mirror", ["--reconcile"]).status, 0);
      assert.equal(callCount(rig, "mempalace_add_drawer") - callsBefore, 6, "+6 calls");
      assert.equal(drawerCount(rig), 6, "still 6 drawers (N, not 2N)");
      assert.deepEqual(Object.keys(drawers(rig)).sort(), idsBefore, "drawer ids unchanged");
      assert.equal(
        logLines(rig)
          .slice(-6)
          .filter((l) => l.includes('"already_exists":true')).length,
        6,
        "the 6 reconcile calls are all already_exists",
      );
      for (const rid of rids) {
        assert.ok(fs.existsSync(mirroredPath(rig, CLI, PERIOD, rid)), "marker restored");
      }
      // converse: no mirror/, no sidecars, a changed wing -> the count does grow
      fs.rmSync(path.join(rig.root, "mirror"), { recursive: true, force: true });
      for (const rid of rids) fs.rmSync(sidecarPath(rig, CLI, PERIOD, rid), { force: true });
      const calls2 = callCount(rig, "mempalace_add_drawer");
      runShim(rig, "usage-mirror", ["--reconcile"], {
        CREWRIG_USAGE_WING: `${SUITE_WING}-CHANGED`,
      });
      assert.equal(callCount(rig, "mempalace_add_drawer") - calls2, 6, "+6 calls again");
      assert.equal(drawerCount(rig), 12, "drawers grow once sidecar is gone and the wing changes");
    });
  });

  // (f) L823: v2-F2 retired the only mempalace_search caller
  test("(f) the log of every rig holds no mempalace_search call", () => {
    assert.equal(searchCalls, 0, "mempalace_search was called");
  });
});

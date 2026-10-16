// usage-mirror-prune.test.ts — groups (d), (e) and (g) of the fake-daemon mirror suite
// (port of scripts/tests/test-usage-storage-mirror.sh, spec 0207 R23, issue #1211;
// spec 0260). Every case seeds its own rig and its own mirrored records: no drawer or
// call count is inherited from another case.

import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, test } from "node:test";
import { seedOpts } from "./lib/usage-mirror-records.ts";
import {
  callCount,
  closeRig,
  control,
  createRig,
  drawerCount,
  drawersForSource,
  entryPath,
  mirroredPath,
  openRig,
  runShim,
  type Rig,
  SKIP_REASON,
  sidecarPath,
  startFake,
  stopFake,
  toolFailure,
  writeRecord,
} from "./lib/usage-mirror-rig.ts";

const DEL = "mempalace_delete_by_source";

async function withMirrored(
  name: string,
  cli: string,
  instant: string,
  n: number,
  fn: (rig: Rig, rids: string[], period: string) => Promise<void>,
): Promise<void> {
  const rig = await openRig(createRig(name));
  try {
    const rids = seedOpts(name, cli, instant, n, true).map((o) => writeRecord(o));
    await startFake(rig);
    assert.equal(runShim(rig, "usage-mirror").status, 0, "setup: catch-up");
    const period = instant.slice(0, 7);
    for (const rid of rids) {
      assert.ok(fs.existsSync(mirroredPath(rig, cli, period, rid)), "setup: record mirrored");
    }
    assert.equal(drawerCount(rig), n, "setup: one drawer per record");
    await fn(rig, rids, period);
  } finally {
    await closeRig(rig);
  }
}

const gone = (rig: Rig, cli: string, per: string, rid: string): boolean =>
  ![entryPath, sidecarPath, mirroredPath].some((f) => fs.existsSync(f(rig, cli, per, rid)));

describe("usage mirror prune", { skip: SKIP_REASON }, () => {
  // (d) L678: refuses with the daemon down, then N delete_by_source calls
  test("(d) prune refuses when the daemon is unreachable, then prunes with N=6 deletes", async () => {
    await withMirrored(
      "prune-d",
      "claude-code",
      "2022-11-01T00:00:00.000Z",
      6,
      async (rig, rids, per) => {
        await stopFake(rig);
        const refused = runShim(rig, "usage-prune", ["claude-code", per]);
        assert.notEqual(refused.status, 0, "prune must refuse while the daemon is down");
        assert.match(refused.stderr, /daemon is unreachable/);
        for (const rid of rids) {
          assert.ok(fs.existsSync(entryPath(rig, "claude-code", per, rid)), "entry survives");
        }
        assert.equal(drawerCount(rig), 6, "drawers untouched by the refused prune");

        await startFake(rig);
        const before = callCount(rig, DEL);
        assert.equal(runShim(rig, "usage-prune", ["claude-code", per]).status, 0);
        assert.equal(callCount(rig, DEL) - before, 6, "exactly 6 delete_by_source calls");
        for (const rid of rids)
          assert.ok(gone(rig, "claude-code", per, rid), "entry/sidecar/marker");
        assert.equal(drawerCount(rig), 0, "the fake holds zero drawers");
      },
    );
  });

  // (e) L751: interrupted prune resumes (failDeleteAfter)
  test("(e) interrupted prune resumes idempotently (failDeleteAfter 1 then 3)", async () => {
    await withMirrored(
      "prune-e",
      "gemini-cli",
      "2021-07-01T00:00:00.000Z",
      3,
      async (rig, rids, per) => {
        await control(rig, { failDeleteAfter: 1 });
        assert.notEqual(runShim(rig, "usage-prune", ["gemini-cli", per]).status, 0, "interrupted");
        const remaining = rids.filter((r) => fs.existsSync(entryPath(rig, "gemini-cli", per, r)));
        assert.equal(rids.length - remaining.length, 1, "exactly 1 removed");
        assert.equal(remaining.length, 2, "2 remain");
        await control(rig, { failDeleteAfter: null });
        assert.equal(
          runShim(rig, "usage-prune", ["gemini-cli", per]).status,
          0,
          "re-run completes",
        );
        for (const rid of rids) assert.ok(gone(rig, "gemini-cli", per, rid), "fully removed");
      },
    );
  });

  // (g) L833: delete_by_source tool-level failures keep the record (#1211)
  const shapes = [
    "success-false",
    "dry-run",
    "no-success-key",
    "is-error",
    "not-json-text",
    "no-text-content",
    "no-result",
  ];
  for (const shape of shapes) {
    test(`(g) [${shape}] unconfirmed delete keeps the record; recovery removes it`, async () => {
      await withMirrored(
        `prune-g-${shape}`,
        "gemini-cli",
        "2019-03-01T00:00:00.000Z",
        1,
        async (rig, [rid], per) => {
          const entry = entryPath(rig, "gemini-cli", per, rid);
          await toolFailure(rig, DEL, shape);
          const before = callCount(rig, DEL);
          const r = runShim(rig, "usage-prune", ["gemini-cli", per]);
          assert.notEqual(r.status, 0, "prune exits non-zero");
          assert.equal(callCount(rig, DEL) - before, 1, "exactly one delete_by_source call");
          assert.match(r.stderr, /did not confirm/);
          assert.doesNotMatch(r.stderr, /unreachable/);
          for (const f of [mirroredPath, entryPath, sidecarPath]) {
            assert.ok(
              fs.existsSync(f(rig, "gemini-cli", per, rid)),
              "marker, entry and sidecar kept",
            );
          }
          assert.equal(drawersForSource(rig, entry).length, 1, "the drawer is kept");

          await toolFailure(rig, DEL, null);
          assert.equal(
            runShim(rig, "usage-prune", ["gemini-cli", per]).status,
            0,
            "recovery succeeds",
          );
          assert.ok(gone(rig, "gemini-cli", per, rid), "recovery removes entry, sidecar, marker");
          assert.equal(drawersForSource(rig, entry).length, 0, "zero drawers remain");
        },
      );
    });
  }
});

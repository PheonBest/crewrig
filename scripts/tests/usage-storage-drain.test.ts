// usage-storage-drain.test.ts — drain, sweep, budget and lock of test-usage-storage.sh
// (spec 0260): (k) drain and sweep + --undrained, (k2) drain budget, (l) drain lock.
// Each describe owns its sandbox, so no case depends on a sibling's leftovers.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import {
  backdate,
  drainLock,
  entryPath,
  makeRecord,
  query,
  sandbox,
  sidecarPath,
  writeRecord,
  type Sandbox,
} from "./lib/usage-storage-rig.ts";
import { REPO } from "./lib/worktree-fixtures.ts";

const INSTANT = "2023-02-01T00:00:00.000Z";
const PERIOD = "2023-02";
const TWO_HOURS = 7_200_000;
const mk = (tag: string) =>
  makeRecord({ cli: "gemini-cli", session: tag, idem: `${tag}-key`, requestInstant: INSTANT });
const hex = (): string => randomBytes(32).toString("hex");
const spoolDir = (sb: Sandbox): string => path.join(sb.root, "spool");
const spoolJson = (sb: Sandbox): string[] =>
  fs.existsSync(spoolDir(sb))
    ? fs.readdirSync(spoolDir(sb)).filter((f) => f.endsWith(".json"))
    : [];

/** Place a valid record in spool/ under its recordId and return its id. */
function spool(sb: Sandbox, tag: string): string {
  const rec = mk(tag);
  fs.mkdirSync(spoolDir(sb), { recursive: true });
  fs.writeFileSync(path.join(spoolDir(sb), `${rec.recordId}.json`), JSON.stringify(rec));
  return rec.recordId;
}

describe("(k) drain and sweep", () => {
  const sb = sandbox();
  after(() => sb.cleanup());
  const invalidName = hex();
  const staleTmp = path.join(sb.root, "tmp", "stale-temp-file.tmp");
  const staleStray = path.join(spoolDir(sb), `.${hex()}.12345.999999999.tmp`);
  const freshStray = path.join(spoolDir(sb), `.${hex()}.12345.999999999.tmp`);
  let rid1 = "";
  let rid2 = "";

  before(() => {
    rid1 = spool(sb, "drain-a");
    rid2 = spool(sb, "drain-b");
    const invalid = path.join(
      REPO,
      "scripts/tests/fixtures/usage-records/mutants/missing-fidelity.json",
    );
    fs.copyFileSync(invalid, path.join(spoolDir(sb), `${invalidName}.json`));
    fs.mkdirSync(path.dirname(staleTmp), { recursive: true });
    for (const f of [staleTmp, staleStray, freshStray]) fs.writeFileSync(f, "x\n");
    backdate(staleTmp, TWO_HOURS);
    backdate(staleStray, TWO_HOURS);
    // The triggering write: drainAndSweep() runs once per process, before its own write.
    assert.equal(writeRecord(sb, mk("drain-trigger")).state, "stored");
  });

  test("both spooled records are drained into the journal, with sidecars", () => {
    for (const rid of [rid1, rid2]) {
      assert.ok(fs.existsSync(entryPath(sb, "gemini-cli", PERIOD, rid)), `entry ${rid} missing`);
      assert.ok(
        fs.existsSync(sidecarPath(sb, "gemini-cli", PERIOD, rid)),
        `sidecar ${rid} missing`,
      );
    }
  });

  test("both drained spool files are gone", () => {
    assert.ok(!spoolJson(sb).includes(`${rid1}.json`));
    assert.ok(!spoolJson(sb).includes(`${rid2}.json`));
  });

  test("the schema-invalid spooled record is left in place, never destroyed", () => {
    assert.ok(fs.existsSync(path.join(spoolDir(sb), `${invalidName}.json`)));
  });

  test("the stale tmp/ file is swept", () => {
    assert.equal(fs.existsSync(staleTmp), false);
  });

  test("the stale spool/ dotfile stray is swept", () => {
    assert.equal(fs.existsSync(staleStray), false);
  });

  test("a FRESH spool/ dotfile stray is left alone (age-gated, not a blanket sweep)", () => {
    assert.ok(fs.existsSync(freshStray));
  });

  test("--undrained lists the rejected spooled record, classed distinctly", () => {
    const out = query(sb, ["--undrained"]);
    assert.ok(out.stdout.includes(invalidName), out.stdout);
    assert.ok(out.stdout.includes("spooled-record"), out.stdout);
  });
});

describe("(k2) drain budget bounds one call, the remainder drains next time", () => {
  const sb = sandbox();
  after(() => sb.cleanup());
  // 1 ms is probabilistic with few records: seed many so the budget always bites.
  const COUNT = 40;
  let rids: string[] = [];

  before(() => {
    rids = Array.from({ length: COUNT }, (_, i) => spool(sb, `budget-${i + 1}`));
  });

  test("a 1 ms CREWRIG_USAGE_DRAIN_BUDGET_MS leaves records undrained", () => {
    const out = writeRecord(sb, mk("budget-trigger-1"), { CREWRIG_USAGE_DRAIN_BUDGET_MS: "1" });
    assert.equal(out.state, "stored");
    const remaining = spoolJson(sb).length;
    assert.ok(remaining > 0, "a 1 ms budget drained every record: the budget bounds nothing");
    assert.ok(remaining < COUNT + 1, "nothing at all was drained");
  });

  test("the remainder is fully drained by the next unbounded write", () => {
    assert.equal(writeRecord(sb, mk("budget-trigger-2")).state, "stored");
    assert.equal(spoolJson(sb).length, 0);
  });

  test("all seeded records eventually reached the journal", () => {
    for (const rid of rids) {
      assert.ok(fs.existsSync(entryPath(sb, "gemini-cli", PERIOD, rid)), `entry ${rid} missing`);
    }
  });

  test("spool/ is removed (best-effort rmdir) once empty", () => {
    assert.equal(fs.existsSync(spoolDir(sb)), false);
  });
});

describe("(l) drain lock: release, stale reclaim, live-peer skip", () => {
  const sb = sandbox();
  after(() => sb.cleanup());
  const lock = drainLock(sb);
  let liveRid = "";

  before(() => {
    liveRid = spool(sb, "lock-live");
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    fs.writeFileSync(lock, ""); // fresh mtime: a live peer holds the lock
  });

  test("a write proceeds while a live peer holds the lock (R4: never blocked)", () => {
    assert.equal(writeRecord(sb, mk("lock-test-1")).state, "stored");
  });

  test("the spooled record is left untouched: the drain was skipped", () => {
    assert.ok(fs.existsSync(path.join(spoolDir(sb), `${liveRid}.json`)));
  });

  test("the live peer's lock file is left in place", () => {
    assert.ok(fs.existsSync(lock));
  });

  test("a stale lock (20 min, past the 15 min default) is reclaimed, the drain runs", () => {
    backdate(lock, 1_200_000);
    assert.equal(writeRecord(sb, mk("lock-test-2")).state, "stored");
    assert.equal(fs.existsSync(path.join(spoolDir(sb), `${liveRid}.json`)), false);
  });

  test("locks/drain.lock is released after the drain completes", () => {
    assert.equal(fs.existsSync(lock), false);
  });
});

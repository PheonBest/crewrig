// usage-attribution-prune.test.ts — Prune of test-usage-attribution.sh (spec 0260 groups PRUNE-26,
// PRUNE-27, PRUNE-28; Bash L858-952; spec 0208 R17, delta-01 R31-R33). The synthetic cli-period
// store `test-store` is registered on a temp COPY of the usage libraries, and `usage-prune.ts`
// of that copy runs against it; no tracked file is edited (PRUNE-28 is therefore a hash check).

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import type { MutationCopy } from "./lib/mutation-copy.ts";
import {
  attributionCopy,
  copyCase,
  LAYOUT,
  PRUNE_CLI,
  PRUNE_PERIOD,
  registerTestStore,
  seedPrune,
  type PruneSeed,
} from "./lib/usage-attribution-prune-rig.ts";
import {
  cli,
  driver,
  fixture,
  journalPath,
  realTmp,
  recordId,
  walkFiles,
} from "./lib/usage-attribution-rig.ts";
import { cleanupAll, REPO } from "./lib/worktree-fixtures.ts";

const sha = (file: string): string =>
  crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

describe("usage attribution prune (R17, delta-01 R31-R33)", () => {
  let copy: MutationCopy;
  const layoutBefore = sha(path.join(REPO, LAYOUT));

  before(() => {
    copy = attributionCopy();
    registerTestStore(copy);
  });
  after(() => {
    copy.dispose();
    cleanupAll();
  });

  describe("PRUNE-26 both registry arms execute", () => {
    let seed: PruneSeed;
    let report = "";
    let root = "";

    before(() => {
      const c = copyCase(copy);
      root = c.root;
      seed = seedPrune(c, realTmp("usage-attr-nogit-"), "Prune R17 scenario ledger entry");
      assert.ok(fs.existsSync(seed.entry), "seeded journal entry missing");
      assert.ok(fs.existsSync(seed.attr), "seeded .attr.json sidecar missing");
      const out = cli(c, "prune", [PRUNE_CLI, PRUNE_PERIOD, "--force"], copy.root);
      assert.equal(out.status, 0, out.stderr);
      report = out.stdout + out.stderr;
    });

    test("PRUNE-26 the journal entry and its .attr.json sidecar are both removed", () => {
      assert.ok(!fs.existsSync(seed.entry), "journal entry survived the prune");
      assert.ok(!fs.existsSync(seed.attr), ".attr.json sidecar survived the prune");
    });

    test("PRUNE-26 the attribution-ledger entries of the period are removed", () => {
      const left = walkFiles(path.join(root, "ledger", PRUNE_PERIOD));
      assert.deepEqual(left, [], `ledger entries survived: ${left.join(",")}`);
    });

    test("PRUNE-26 the report names attribution-ledger with a non-zero count", () => {
      assert.ok(report.includes("attribution-ledger"), report);
      assert.match(report, /attribution-ledger: [1-9]/i);
    });

    test("PRUNE-26 the cli-period arm unlinks the entry, rmdirs the partition, reports test-store: 1", () => {
      assert.ok(!fs.existsSync(seed.partition), "emptied test-store partition still exists");
      assert.ok(report.includes("test-store"), report);
      assert.match(report, /test-store: 1/i);
    });
  });

  describe("PRUNE-27 no registered store holds anything", () => {
    let report = "";
    let entry = "";

    before(() => {
      const c = copyCase(copy);
      const file = fixture("prune-no-store-record.json");
      const sub = driver(c, ["submit", file], { ATTR_CTX_CWD: realTmp("usage-attr-nogit-") });
      assert.match(sub.stdout, /"status":"stored"/, `prune no-store record: ${sub.stdout}`);
      const period = driver(c, ["period", file]).stdout.trim();
      entry = journalPath(c.root, PRUNE_CLI, period, recordId(file));
      assert.ok(fs.existsSync(entry), "no-store entry missing before the prune");
      const out = cli(c, "prune", [PRUNE_CLI, period, "--force"], copy.root);
      assert.equal(out.status, 0, out.stderr);
      report = out.stdout + out.stderr;
    });

    test("PRUNE-27 the journal entry is still removed", () => {
      assert.ok(!fs.existsSync(entry), "no-store journal entry survived");
    });

    test("PRUNE-27 no derived store is named in the report (delta-01 R33 second clause)", () => {
      assert.ok(!/attribution-ledger/i.test(report), report);
      assert.ok(!/test-store/i.test(report), report);
    });
  });

  test("PRUNE-28 the tracked layout.js is untouched (the registration went on a copy)", () => {
    assert.equal(sha(path.join(REPO, LAYOUT)), layoutBefore);
    assert.ok(fs.readFileSync(path.join(copy.root, LAYOUT), "utf8").includes("test-store"));
    assert.ok(!fs.readFileSync(path.join(REPO, LAYOUT), "utf8").includes("test-store"));
  });
});

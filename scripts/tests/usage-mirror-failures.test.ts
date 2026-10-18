// usage-mirror-failures.test.ts — groups (h), (i), (j), the breaker-cap contrast and the
// decoder-throws fault injection of the fake-daemon mirror suite (port of
// scripts/tests/test-usage-storage-mirror.sh, spec 0207 R23; spec 0260). Each test owns
// its rig; the exact call counts of (j) (3, then 8, then 3) are the contract.

import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, test } from "node:test";
import { allMirrored, allPending, seedBacklog } from "./lib/usage-mirror-backlog.ts";
import { seedOpts } from "./lib/usage-mirror-records.ts";
import {
  callCount,
  clearSourceToolFailure,
  closeRig,
  createRig,
  drawersForSource,
  entryPath,
  jsonrpcError,
  mirroredPath,
  openRig,
  pendingCount,
  pendingPath,
  runShim,
  type Rig,
  SKIP_REASON,
  startFake,
  toolFailure,
  writeRecord,
} from "./lib/usage-mirror-rig.ts";
import { copyLibTree, applyMutation } from "./lib/usage-mutants.ts";
import { REPO } from "./lib/worktree-fixtures.ts";

const require = createRequire(import.meta.url);
const BREAKER = "CREWRIG_USAGE_MIRROR_TOOL_ERROR_BREAKER";
const ADD = "mempalace_add_drawer";

async function withRig(name: string, fn: (rig: Rig) => Promise<void>): Promise<void> {
  const rig = await openRig(createRig(name));
  try {
    await startFake(rig);
    await fn(rig);
  } finally {
    await closeRig(rig);
  }
}

describe("usage mirror failures", { skip: SKIP_REASON }, () => {
  // (h) L906: add_drawer failures; the call counts 2 versus 1 are the contract
  for (const [shape, expectedCalls] of [
    ["success-false", 2],
    ["no-success-key", 1],
    ["not-json-text", 1],
  ] as const) {
    test(`(h) add_drawer failure ${shape}: ${expectedCalls} call(s), markers pending, recovery mirrors both`, async () => {
      await withRig(`mirror-h-${shape}`, async (rig) => {
        const cli = "copilot-cli";
        const rids = seedOpts("toolfail-add", cli, "2019-04-01T00:00:00.000Z", 2).map((o) =>
          writeRecord(o),
        );
        const stamp = path.join(rig.root, "mirror", "unreachable.stamp");
        assert.equal(pendingCount(rig), 2, "setup: pending/ holds exactly the two (h) markers");
        await toolFailure(rig, ADD, shape);
        const r = runShim(rig, "usage-mirror");
        assert.equal(r.status, 0, `[${shape}] usage-mirror exits 0`);
        assert.equal(callCount(rig, ADD), expectedCalls, `[${shape}] add_drawer call count`);
        for (const rid of rids) {
          assert.ok(fs.existsSync(pendingPath(rig, cli, "2019-04", rid)), "marker stays pending");
          assert.ok(!fs.existsSync(mirroredPath(rig, cli, "2019-04", rid)), "marker not mirrored");
          assert.equal(drawersForSource(rig, entryPath(rig, cli, "2019-04", rid)).length, 0);
        }
        if (shape === "success-false") {
          assert.equal(r.stderr.split("\n").filter((l) => l.includes("failed:")).length, 2);
        } else {
          assert.ok(r.stderr.includes("stopping this pass"), "stderr: stopping this pass");
        }
        assert.ok(!fs.existsSync(stamp), "no unreachable.stamp (the daemon answered)");

        await toolFailure(rig, ADD, null);
        assert.equal(runShim(rig, "usage-mirror").status, 0);
        for (const rid of rids) {
          assert.ok(fs.existsSync(mirroredPath(rig, cli, "2019-04", rid)), "recovery: mirrored");
          assert.equal(drawersForSource(rig, entryPath(rig, cli, "2019-04", rid)).length, 1);
        }
        assert.equal(pendingCount(rig), 0, "recovery: pending/ is empty");
      });
    });
  }

  // (i) L1008: JSON-RPC error-code classification through mcp.addDrawer, in-process
  for (const [code, kind] of [
    [-32000, "tool-error"],
    [-32602, "tool-error"],
    [-32001, "tool-unavailable"],
    [-32002, "tool-unavailable"],
    [-32003, "tool-unavailable"],
    [-32099, "tool-unavailable"],
  ] as const) {
    test(`(i) code ${code} classified as ${kind}`, async () => {
      await withRig(`mirror-i${code}`.replace("-", "n"), async (rig) => {
        await jsonrpcError(rig, ADD, code);
        const mcp = require(path.join(REPO, "scripts/lib/usage-store/mcp.js")) as {
          addDrawer(a: Record<string, string>): Promise<{ ok: boolean; kind?: string }>;
        };
        const res = await mcp.addDrawer({
          wing: "kind-classification-wing",
          room: "usage-records",
          content: JSON.stringify({ probe: true }),
          source_file: path.join(rig.helpers, `jsonrpc-probe-${code}.json`),
          added_by: "test-fixture-probe",
        });
        assert.equal(res.ok ? "ok" : res.kind, kind);
      });
    });
  }

  // (j) L1044: breaker + ordering, end to end. Calls 3 / 8 / 3 are the contract.
  test("(j) breaker + ordering passes 1-4 (CREWRIG_USAGE_MIRROR_TOOL_ERROR_BREAKER=3)", async () => {
    await withRig("mirror-j", async (rig) => {
      const b = await seedBacklog(rig, "claude-code", "2018-08-01T00:00:00.000Z");
      const pass = (): { calls: number; stderr: string } => {
        const before = callCount(rig, ADD);
        const r = runShim(rig, "usage-mirror", [], { [BREAKER]: "3" });
        return { calls: callCount(rig, ADD) - before, stderr: r.stderr };
      };
      const p1 = pass();
      assert.equal(p1.calls, 3, "pass 1: exactly 3 add_drawer calls");
      assert.ok(p1.stderr.includes("breaker tripped"), "pass 1: breaker tripped on stderr");
      assert.ok(!allMirrored(rig, b, b.healthy), "pass 1: healthy markers not reached");
      assert.ok(allPending(rig, b, b.healthy) && allPending(rig, b, b.poison));
      assert.equal(pass().calls, 8, "pass 2: exactly 8 add_drawer calls (5 + 3)");
      assert.ok(allMirrored(rig, b, b.healthy), "pass 2: healthy markers mirrored (the fix)");
      assert.ok(allPending(rig, b, b.poison), "pass 2: poisoned markers still pending");
      assert.equal(pass().calls, 3, "pass 3: exactly 3 add_drawer calls");
      assert.equal(pass().calls, 3, "pass 4: steady state, 3 calls");
      assert.ok(allMirrored(rig, b, b.healthy) && allPending(rig, b, b.poison));
    });
  });

  // MUT breaker cap removed (env only, no source edit): L1670
  test("breaker cap removed (BREAKER=999999): one pass mirrors both healthy records", async () => {
    await withRig("mirror-nocap", async (rig) => {
      const b = await seedBacklog(rig, "gemini-cli", "2018-09-01T00:00:00.000Z");
      runShim(rig, "usage-mirror", [], { [BREAKER]: "999999" });
      assert.ok(allMirrored(rig, b, b.healthy), "both healthy mirrored after one uncapped pass");
      await clearSourceToolFailure(rig);
    });
  });

  // FAULT INJECTION decoder throws: L1597, on a mutated copy of mcp.js
  test("decoder throws: exit 0, lock released, marker pending, 'stopping this pass'; restored recovers", async () => {
    await withRig("mirror-fault", async (rig) => {
      const cli = "claude-code";
      const [rid] = seedOpts("fault", cli, "2019-07-01T00:00:00.000Z", 1).map((o) =>
        writeRecord(o),
      );
      const copy = copyLibTree(["scripts/usage-mirror.ts", "scripts/lib/node-floor-guard.js"]);
      try {
        applyMutation(
          copy,
          "scripts/lib/usage-store/mcp.js",
          "function decodeToolResult(parsed) {",
          "function decodeToolResult(parsed) { throw new Error('fault injection');",
        );
        const r = runShim(rig, "usage-mirror", [], {}, copy.root);
        assert.equal(r.status, 0, "a throwing decoder does not crash the catch-up");
        assert.ok(!fs.existsSync(path.join(rig.root, "locks", "mirror.lock")), "lock released");
        assert.ok(fs.existsSync(pendingPath(rig, cli, "2019-07", rid)), "marker stays pending");
        assert.ok(!fs.existsSync(mirroredPath(rig, cli, "2019-07", rid)));
        assert.ok(r.stderr.includes("stopping this pass"), "stderr: stopping this pass");
      } finally {
        copy.dispose();
      }
      assert.equal(runShim(rig, "usage-mirror").status, 0); // the unmutated tree recovers
      assert.ok(fs.existsSync(mirroredPath(rig, cli, "2019-07", rid)), "recovery: mirrored");
      assert.equal(pendingCount(rig), 0, "recovery: pending/ is empty");
    });
  });
});

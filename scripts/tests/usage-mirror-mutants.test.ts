// usage-mirror-mutants.test.ts — the in-place mutations of the Bash mirror suite
// (sidecar fast path, rename, prune skip, lock race, requireSuccess, dry_run, mtime
// touch), now run on a TEMP COPY of the usage-store tree (spec 0260 requirement 6; no
// tracked file is edited). Every mutant is proven red AND has a green twin: the same
// scenario on an unmutated copy of the same tree. A missing needle fails the test.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { allMirrored, seedBacklog } from "./lib/usage-mirror-backlog.ts";
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
  runShim,
  type Rig,
  SKIP_REASON,
  sidecarPath,
  spawnShim,
  startFake,
  toolFailure,
  writeRecord,
} from "./lib/usage-mirror-rig.ts";
import { applyMutation, copyLibTree } from "./lib/usage-mutants.ts";

const MIRROR = "scripts/lib/usage-store/mirror.js";
const PRUNE = "scripts/lib/usage-store/prune.js";
const MCP = "scripts/lib/usage-store/mcp.js";
const BREAKER = "CREWRIG_USAGE_MIRROR_TOOL_ERROR_BREAKER";
const EXTRA = [
  "scripts/usage-mirror.ts",
  "scripts/usage-mirror.sh",
  "scripts/usage-prune.sh",
  "scripts/lib/node-floor-guard.js",
];

type Needle = string | RegExp;
interface Mutation {
  file: string;
  needle: Needle;
  replacement: string;
}

/** Run `scenario` on a fresh rig against a copy of the tree, mutated or (undefined) not. */
async function observe<T>(
  name: string,
  mutation: Mutation | undefined,
  scenario: (rig: Rig, repo: string) => Promise<T>,
): Promise<T> {
  const copy = copyLibTree(EXTRA);
  const rig = await openRig(createRig(name));
  try {
    if (mutation !== undefined) {
      applyMutation(copy, mutation.file, mutation.needle, mutation.replacement);
    }
    await startFake(rig);
    return await scenario(rig, copy.root);
  } finally {
    await closeRig(rig);
    copy.dispose();
  }
}

const one = (rig: Rig, cli: string, instant: string, tag: string): string =>
  writeRecord(seedOpts(tag, cli, instant, 1)[0]);

describe("usage mirror mutants", { skip: SKIP_REASON }, () => {
  // MUT reconcile-sidecar L1219: the sidecar fast path disabled -> the wing is re-derived
  const sidecarMutation: Mutation = {
    file: MIRROR,
    needle:
      "if (parsed && typeof parsed.wing === 'string' && typeof parsed.wingDerivation === 'string') {\n    return { wing: parsed.wing, wingDerivation: parsed.wingDerivation };\n  }",
    replacement:
      "if (false) {\n    return { wing: parsed.wing, wingDerivation: parsed.wingDerivation };\n  }",
  };
  const sidecarScenario = async (rig: Rig, repo: string): Promise<string> => {
    const rid = one(rig, "claude-code", "2020-02-01T00:00:00.000Z", "mutant-reconcile");
    const sidecar = sidecarPath(rig, "claude-code", "2020-02", rid);
    const s = JSON.parse(fs.readFileSync(sidecar, "utf8")) as Record<string, unknown>;
    s.wing = "sidecar-original-wing";
    s.wingDerivation = "test-fixture";
    fs.writeFileSync(sidecar, JSON.stringify(s));
    runShim(rig, "usage-mirror", [], {}, repo);
    const [d] = drawersForSource(rig, entryPath(rig, "claude-code", "2020-02", rid));
    return d === undefined ? "NOT_FOUND" : d.wing;
  };
  test("MUT reconcile-sidecar: green honours the sidecar wing, mutant re-derives the suite wing", async () => {
    assert.equal(await observe("mut-sc-g", undefined, sidecarScenario), "sidecar-original-wing");
    assert.equal(
      await observe("mut-sc-r", sidecarMutation, sidecarScenario),
      "usage-storage-mirror-suite",
    );
  });

  // MUT rename dropped L1273
  const renameScenario = async (rig: Rig, repo: string) => {
    const rid = one(rig, "copilot-cli", "2020-03-01T00:00:00.000Z", "mutant-rename");
    runShim(rig, "usage-mirror", [], {}, repo);
    return {
      drawers: drawerCount(rig),
      pending: fs.existsSync(pendingPath(rig, "copilot-cli", "2020-03", rid)),
      mirrored: fs.existsSync(mirroredPath(rig, "copilot-cli", "2020-03", rid)),
    };
  };
  test("MUT rename dropped: green moves the marker, mutant leaves it pending despite the drawer", async () => {
    const green = await observe("mut-rn-g", undefined, renameScenario);
    assert.deepEqual(green, { drawers: 1, pending: false, mirrored: true });
    const red = await observe(
      "mut-rn-r",
      {
        file: MIRROR,
        needle: "fs.renameSync(pendingPath, mirroredPath);",
        replacement: "/* mutation: rename dropped */",
      },
      renameScenario,
    );
    assert.deepEqual(red, { drawers: 1, pending: true, mirrored: false });
  });

  // MUT prune skips delete_by_source L1323
  const pruneScenario = async (rig: Rig, repo: string) => {
    const rid = one(rig, "antigravity", "2020-04-01T00:00:00.000Z", "mutant-prune");
    runShim(rig, "usage-mirror", [], {}, repo);
    assert.equal(drawerCount(rig), 1, "setup: mirrored before pruning");
    const r = runShim(rig, "usage-prune", ["antigravity", "2020-04"], {}, repo);
    return {
      status: r.status,
      entry: fs.existsSync(entryPath(rig, "antigravity", "2020-04", rid)),
      drawers: drawerCount(rig),
    };
  };
  test("MUT prune skips delete_by_source: green removes the drawer, mutant orphans it", async () => {
    assert.deepEqual(await observe("mut-pr-g", undefined, pruneScenario), {
      status: 0,
      entry: false,
      drawers: 0,
    });
    const red = await observe(
      "mut-pr-r",
      {
        file: PRUNE,
        needle:
          "const result = await mcp.deleteBySource({ source_file: entryPath, dry_run: false });\n    if (!result.ok) {\n      return { ok: false, kind: result.kind, message: result.message };\n    }",
        replacement: "/* mutation: delete_by_source skipped */",
      },
      pruneScenario,
    );
    assert.deepEqual(red, { status: 0, entry: false, drawers: 1 });
  });

  // MUT lock race L1381: hold locks/mirror.lock ~3 s (the Bash suite held it 0.5 s, too tight under load)
  const lockScenario = async (rig: Rig, repo: string): Promise<boolean> => {
    const rids = seedOpts("lockrace", "claude-code", "2020-05-01T00:00:00.000Z", 3).map((o) =>
      writeRecord(o),
    );
    const lock = path.join(rig.root, "locks", "mirror.lock");
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    fs.writeFileSync(lock, ""); // fresh mtime: a live peer holds the lock
    const releaser = setTimeout(() => fs.rmSync(lock, { force: true }), 3000);
    const run = await spawnShim(
      rig,
      "usage-mirror",
      [],
      { CREWRIG_USAGE_MIRROR_WAIT_MS: "30000" },
      repo,
    );
    clearTimeout(releaser);
    fs.rmSync(lock, { force: true }); // the mutant may return before the 0.5 s release
    assert.notEqual(run.status, null, "the catch-up ran to completion");
    return rids.every((rid) => fs.existsSync(mirroredPath(rig, "claude-code", "2020-05", rid)));
  };
  test("MUT lock race: green waits out the lock and mirrors all 3, mutant leaves them unmirrored", async () => {
    assert.equal(await observe("mut-lk-g", undefined, lockScenario), true);
    const red = await observe(
      "mut-lk-r",
      {
        file: MIRROR,
        needle:
          "const acquired = explicit\n    ? await acquireLockWaiting(lockFile, staleMs, envMs('CREWRIG_USAGE_MIRROR_WAIT_MS', staleMs))\n    : tryAcquireLock(lockFile, staleMs);",
        replacement:
          "const acquired = tryAcquireLock(lockFile, staleMs); // mutation: explicit wait dropped",
      },
      lockScenario,
    );
    assert.equal(red, false);
  });

  // MUT requireSuccess dropped L1479: delete_by_source answers success:false
  const ackScenario = async (rig: Rig, repo: string) => {
    const rid = one(rig, "antigravity", "2019-05-01T00:00:00.000Z", "mutant-ack");
    runShim(rig, "usage-mirror", [], {}, repo);
    const entry = entryPath(rig, "antigravity", "2019-05", rid);
    assert.equal(drawersForSource(rig, entry).length, 1, "setup: one drawer");
    await toolFailure(rig, "mempalace_delete_by_source", "success-false");
    const r = runShim(rig, "usage-prune", ["antigravity", "2019-05"], {}, repo);
    return {
      status: r.status === 0 ? 0 : 1,
      mirrored: fs.existsSync(mirroredPath(rig, "antigravity", "2019-05", rid)),
      drawers: drawersForSource(rig, entry).length,
    };
  };
  test("MUT requireSuccess dropped: green refuses a success:false delete, mutant takes it as done", async () => {
    assert.deepEqual(await observe("mut-ack-g", undefined, ackScenario), {
      status: 1,
      mirrored: true,
      drawers: 1,
    });
    const red = await observe(
      "mut-ack-r",
      {
        file: MCP,
        needle:
          "if (payload && typeof payload === 'object' && payload.success === true) return res;",
        replacement: "return res; // mutation: any answer counts as acknowledged",
      },
      ackScenario,
    );
    assert.deepEqual(red, { status: 0, mirrored: false, drawers: 1 });
  });

  // MUT dry_run:false dropped L1531
  const dryScenario = async (rig: Rig, repo: string) => {
    const rid = one(rig, "antigravity", "2019-06-01T00:00:00.000Z", "mutant-dryrun");
    runShim(rig, "usage-mirror", [], {}, repo);
    const entry = entryPath(rig, "antigravity", "2019-06", rid);
    assert.equal(drawersForSource(rig, entry).length, 1, "setup: one drawer");
    const r = runShim(rig, "usage-prune", ["antigravity", "2019-06"], {}, repo);
    const last =
      logLines(rig)
        .filter((l) => l.includes('"tool":"mempalace_delete_by_source"'))
        .pop() ?? "";
    return {
      refused: r.status !== 0,
      namesDryRun: r.stderr.includes("dry run"),
      kept: fs.existsSync(entry) && drawersForSource(rig, entry).length === 1,
      lastIsDry: last.includes('"dry_run":true'),
    };
  };
  test("MUT dry_run:false dropped: green prunes, mutant is refused naming the dry run", async () => {
    assert.deepEqual(await observe("mut-dr-g", undefined, dryScenario), {
      refused: false,
      namesDryRun: false,
      kept: false,
      lastIsDry: false,
    });
    const red = await observe(
      "mut-dr-r",
      {
        file: PRUNE,
        needle: "mcp.deleteBySource({ source_file: entryPath, dry_run: false })",
        replacement: "mcp.deleteBySource({ source_file: entryPath })",
      },
      dryScenario,
    );
    assert.deepEqual(red, { refused: true, namesDryRun: true, kept: true, lastIsDry: true });
  });

  // MUT touchPendingMarkerMtime removed L1734: two passes, BREAKER=3
  const touchScenario = async (rig: Rig, repo: string): Promise<boolean> => {
    const b = await seedBacklog(rig, "copilot-cli", "2018-10-01T00:00:00.000Z");
    for (let i = 0; i < 2; i++) runShim(rig, "usage-mirror", [], { [BREAKER]: "3" }, repo);
    assert.ok(callCount(rig, "mempalace_add_drawer") >= 6, "the poisoned head was attempted");
    return allMirrored(rig, b, b.healthy);
  };
  test("MUT touchPendingMarkerMtime removed: green mirrors the healthy pair in 2 passes, mutant starves it", async () => {
    assert.equal(await observe("mut-tc-g", undefined, touchScenario), true);
    const red = await observe(
      "mut-tc-r",
      {
        file: MIRROR,
        needle: /^(\s*)touchPendingMarkerMtime\([^)]*\)\s*;\s*$/m,
        replacement: "$1// mutation: touchPendingMarkerMtime() call disabled",
      },
      touchScenario,
    );
    assert.equal(red, false);
  });

  // A missing needle must fail, never skip
  test("a mutation whose needle is absent fails loudly", async () => {
    await assert.rejects(
      observe(
        "mut-missing",
        { file: MIRROR, needle: "this text is not in mirror.js", replacement: "x" },
        async () => true,
      ),
      /mutation needle absent/,
    );
  });
});

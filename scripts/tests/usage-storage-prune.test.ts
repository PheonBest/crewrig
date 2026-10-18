// usage-storage-prune.test.ts — prune, help/docs and validator groups of
// test-usage-storage.sh (spec 0260): (m) prune / unprune, (m2) help text and docs
// paths, (o) build-usage-validator.js --check clean then a named drift reason on a
// temp COPY (the script resolves its repo from __dirname, so no root override is needed).

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { requireOrSkip } from "./lib/capability.ts";
import { copyTracked } from "./lib/mutation-copy.ts";
import {
  drive,
  entryPath,
  makeRecord,
  partitionDir,
  pendingMarker,
  periodOf,
  prune,
  prunedMarker,
  sandbox,
  sidecarPath,
  writeRecord,
} from "./lib/usage-storage-rig.ts";
import { REPO } from "./lib/worktree-fixtures.ts";

// (m) prune / unprune ---------------------------------------------------------
const now = new Date();
// Closed period = now minus 13 months in UTC; day pinned to 1 first so that the
// month arithmetic never overflows (Jan 31 minus 13 months).
const closed = new Date(now);
closed.setUTCDate(1);
closed.setUTCMonth(closed.getUTCMonth() - 13);
const CLOSED_INSTANT = closed.toISOString();
const CURRENT_INSTANT = now.toISOString();
const rec = (tag: string, instant: string) =>
  makeRecord({
    cli: "claude-code",
    session: `${tag}-session`,
    idem: `${tag}-key`,
    requestInstant: instant,
  });

describe("(m) prune / unprune", () => {
  const sb = sandbox();
  after(() => sb.cleanup());
  const CLI = "claude-code";

  before(() => {
    // A token file makes write() leave pending markers; CREWRIG_USAGE_MIRROR=0 keeps them
    // pending forever and never dials a daemon (R8/R19: no daemon for a pending-only period).
    const token = drive(sb, ["token-path"]).stdout.trim();
    fs.mkdirSync(path.dirname(token), { recursive: true });
    fs.writeFileSync(token, "test-token-value\n");
  });

  test("the current period: refused without --force, entry survives, --force removes it", () => {
    const cur = rec("prune-current", CURRENT_INSTANT);
    const per = periodOf(cur);
    assert.equal(writeRecord(sb, cur).state, "stored");
    const entry = entryPath(sb, CLI, per, cur.recordId);
    assert.notEqual(prune(sb, [CLI, per]).status, 0, "pruning the current period without --force");
    assert.ok(fs.existsSync(entry), "the entry was removed despite the refusal");
    assert.equal(prune(sb, [CLI, per, "--force"]).status, 0, "--force must allow it");
    assert.equal(fs.existsSync(entry), false, "the entry survived a --force prune");
  });

  describe("closed period holding pending-only markers", () => {
    const per = periodOf(rec("x", CLOSED_INSTANT));
    const r1 = rec("prune-closed-1", CLOSED_INSTANT);
    const r2 = rec("prune-closed-2", CLOSED_INSTANT);
    const marker = (): string => prunedMarker(sb, CLI, per);
    const pending = (r: { recordId: string }): string => pendingMarker(sb, CLI, per, r.recordId);

    test("setup: 2 entries with pending-only markers", () => {
      assert.equal(writeRecord(sb, r1).state, "stored");
      assert.equal(writeRecord(sb, r2).state, "stored");
      for (const r of [r1, r2]) {
        assert.ok(fs.existsSync(entryPath(sb, CLI, per, r.recordId)));
        assert.ok(fs.existsSync(pending(r)), "no pending marker");
      }
    });

    test("prune succeeds with no daemon; entries, sidecar and pending markers are removed", () => {
      assert.ok(fs.existsSync(sidecarPath(sb, CLI, per, r1.recordId)));
      assert.equal(prune(sb, [CLI, per]).status, 0, "pruning a closed, pending-only period");
      for (const r of [r1, r2]) {
        assert.equal(fs.existsSync(entryPath(sb, CLI, per, r.recordId)), false, "entry survived");
        assert.equal(fs.existsSync(pending(r)), false, "pending marker survived");
      }
      assert.equal(
        fs.existsSync(sidecarPath(sb, CLI, per, r1.recordId)),
        false,
        "sidecar survived",
      );
      assert.ok(fs.existsSync(marker()), `no pruned-period marker at ${marker()}`);
    });

    test("a write for the pruned period is rejected with REASON=period-pruned", () => {
      const out = writeRecord(sb, rec("prune-rewrite", CLOSED_INSTANT));
      assert.equal(out.state, "rejected", out.stdout);
      assert.ok(out.stdout.includes("REASON=period-pruned"), out.stdout);
    });

    test("CREWRIG_USAGE_ALLOW_PRUNED=1 overrides the period-pruned gate", () => {
      const out = writeRecord(sb, rec("prune-rewrite", CLOSED_INSTANT), {
        CREWRIG_USAGE_ALLOW_PRUNED: "1",
      });
      assert.equal(out.state, "stored", out.stdout);
    });

    test("--unprune removes the marker only, entries are not resurrected", () => {
      prune(sb, [CLI, per, "--unprune"]);
      assert.equal(fs.existsSync(marker()), false, "--unprune left the pruned-period marker");
      assert.equal(fs.existsSync(entryPath(sb, CLI, per, r1.recordId)), false, "entry resurrected");
      assert.ok(fs.existsSync(partitionDir(sb, CLI, per)), "the ALLOW_PRUNED write stays");
    });

    test("a plain write (no ALLOW_PRUNED) succeeds again after --unprune", () => {
      const out = writeRecord(sb, rec("unprune-rewrite", CLOSED_INSTANT));
      assert.equal(out.state, "stored", out.stdout);
    });
  });
});

// (m2) help text and docs ---------------------------------------------------------
describe("(m2) prune help carries no purge list; docs names resolve", () => {
  const help = spawnSync(
    process.execPath,
    [path.join(REPO, "scripts", "lib", "usage-store", "prune.js"), "--help"],
    { encoding: "utf8" },
  );
  const text = `${help.stdout}${help.stderr}`;

  test("prune.js --help exits 0", () => {
    assert.equal(help.status, 0, text);
  });
  test("it points at docs/usage-organization.md -> Removing usage data", () => {
    assert.ok(text.includes("docs/usage-organization.md"), text);
    assert.ok(text.includes("Removing usage data"), text);
  });
  test("it names no <root>/ path", () => {
    assert.ok(!text.includes("<root>/"), text);
  });
  test("it carries no `rm -` command", () => {
    assert.ok(!text.includes("rm -"), text);
  });
  test("docs/usage-organization.md carries the '## Removing usage data' heading", () => {
    const lines = fs
      .readFileSync(path.join(REPO, "docs", "usage-organization.md"), "utf8")
      .split(/\r?\n/);
    assert.ok(lines.includes("## Removing usage data"));
  });
  test("every scripts/ path named in docs/usage-storage.md exists", () => {
    const doc = fs.readFileSync(path.join(REPO, "docs", "usage-storage.md"), "utf8");
    const tokens = new Set(doc.match(/scripts\/[A-Za-z0-9_./-]+/g) ?? []);
    const missing: string[] = [];
    for (const raw of tokens) {
      const token = raw.replace(/[.,)`]+$/, ""); // trailing prose punctuation
      if (token !== "" && !fs.existsSync(path.join(REPO, token))) missing.push(token);
    }
    assert.deepEqual(missing, [], `docs/usage-storage.md names scripts/ paths that do not exist`);
  });
});

// (o) build-usage-validator.js --check ----------------------------------------------
describe("(o) build-usage-validator.js --check: clean, then a named drift reason", () => {
  const VALIDATE = "scripts/lib/usage-store/validator/validate.js";
  const tracked = path.join(REPO, VALIDATE);
  const sha = (f: string): string => createHash("sha256").update(fs.readFileSync(f)).digest("hex");
  const check = (root: string) =>
    spawnSync(
      process.execPath,
      [path.join(root, "scripts", "build-usage-validator.js"), "--check"],
      {
        encoding: "utf8",
      },
    );
  const pathspecs = [
    "scripts/build-usage-validator.js",
    "scripts/lib/usage-store/validator",
    "schemas/usage-record",
  ];

  test("--check exits 0 against the committed (unedited) validator output", (t) => {
    if (!requireOrSkip(t, fs.existsSync(path.join(REPO, "node_modules", "ajv")), "ajv installed"))
      return;
    const copy = copyTracked(REPO, pathspecs, { linkNodeModules: true });
    try {
      const r = check(copy.root);
      assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    } finally {
      copy.dispose();
    }
  });

  test("MUTATION RED: an edited validate.js makes --check exit non-zero and name validate.js + drift", (t) => {
    if (!requireOrSkip(t, fs.existsSync(path.join(REPO, "node_modules", "ajv")), "ajv installed"))
      return;
    const before = sha(tracked);
    const copy = copyTracked(REPO, pathspecs, { linkNodeModules: true });
    try {
      fs.appendFileSync(
        path.join(copy.root, VALIDATE),
        "\n// mutation-discipline probe — must never survive as drift-free\n",
      );
      const r = check(copy.root);
      const out = `${r.stdout}${r.stderr}`;
      assert.notEqual(r.status, 0, `--check still exited 0 against an edited validate.js\n${out}`);
      assert.ok(out.includes("validate.js"), out);
      assert.ok(/drift/i.test(out), out);
    } finally {
      copy.dispose();
    }
    assert.equal(sha(tracked), before, "the tracked validate.js was touched by the probe");
  });
});

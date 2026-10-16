// usage-storage-wing.test.ts — groups (i), (j) and MUT-1 of test-usage-storage.sh
// (spec 0260): wing derivation in a synthetic repository with a linked worktree, sidecar
// repair, the mutation that skips the sidecar link, and the #1260 replacement (the
// mutation helper never touches the tracked tree). (j) builds its own entry: the Bash
// case reused one left behind by (a).

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import { applyMutation, copyTracked } from "./lib/mutation-copy.ts";
import { mutated } from "./lib/usage-mutants.ts";
import {
  countFiles,
  drive,
  entryPath,
  makeRecord,
  periodOf,
  readRecord,
  sandbox,
  sidecarPath,
  writeRecord,
  type Sandbox,
} from "./lib/usage-storage-rig.ts";
import { addWorktree, initRepo, realTmp, REPO, WINDOWS } from "./lib/worktree-fixtures.ts";

const boxes: Sandbox[] = [];
const fresh = (repo?: string): Sandbox => {
  const sb = sandbox(repo);
  boxes.push(sb);
  return sb;
};
after(() => {
  for (const sb of boxes) sb.cleanup();
});

function wing(sb: Sandbox, arg: string, extra: Record<string, string> = {}, cwd?: string) {
  const r = drive(sb, ["resolve-wing", arg], extra, cwd);
  return {
    wing: /^WING=(.*)$/m.exec(r.stdout)?.[1] ?? "",
    how: /^DERIVATION=(.*)$/m.exec(r.stdout)?.[1] ?? "",
    out: r.stdout,
  };
}

describe("(i) wing derivation (resolveWing, memoization narrowing)", () => {
  const sb = fresh();
  const parent = realTmp("usage-syn-");
  const repo = path.join(parent, "synrepo");
  initRepo(repo);
  const base = path.basename(repo);
  const linked = addWorktree(repo, "linked-worktree");
  const memos = (): number => countFiles(path.join(sb.root, "cache", "wings"));
  after(() => fs.rmSync(parent, { recursive: true, force: true }));

  // Ordered on purpose: the memo count grows 1, 2, 3 (the Bash cases are the same chain).
  test("repo root -> git-common-dir, wing = basename, memo 1", () => {
    const r = wing(sb, repo);
    assert.deepEqual([r.wing, r.how], [base, "git-common-dir"], r.out);
    assert.equal(memos(), 1);
  });
  test("subdirectory -> same wing via git-common-dir, memo 2", () => {
    const sub = path.join(repo, "some", "nested", "subdir");
    fs.mkdirSync(sub, { recursive: true });
    const r = wing(sb, sub);
    assert.deepEqual([r.wing, r.how], [base, "git-common-dir"], r.out);
    assert.equal(memos(), 2);
  });
  test("live linked worktree -> same wing via git-common-dir, memo 3", () => {
    const r = wing(sb, linked);
    assert.deepEqual([r.wing, r.how], [base, "git-common-dir"], r.out);
    assert.equal(memos(), 3);
  });
  test("removed worktree subpath -> git-common-dir-ancestor, no new memo", () => {
    fs.rmSync(linked, { recursive: true, force: true });
    const r = wing(sb, path.join(linked, "sub", "dir"));
    assert.deepEqual([r.wing, r.how], [base, "git-common-dir-ancestor"], r.out);
    assert.equal(memos(), 3);
  });
  test("'unknown' with cwd inside the repo -> process-cwd, same wing", () => {
    const r = wing(sb, "unknown", {}, repo);
    assert.deepEqual([r.wing, r.how], [base, "process-cwd"], r.out);
  });
  test("'unknown' with a non-repository cwd -> unknown-residual, wing 'unknown'", () => {
    const r = wing(sb, "unknown", {}, realTmp("usage-nongit-"));
    assert.deepEqual([r.wing, r.how], ["unknown", "unknown-residual"], r.out);
  });
  test(
    "nonexistent /tmp-rooted path -> basename-fallback of the original path",
    { skip: WINDOWS ? "SKIP: /tmp-rooted path is POSIX-only" : false },
    () => {
      const r = wing(sb, `/tmp/crewrig-usage-storage-test-nonexistent-${process.pid}/nested`);
      assert.deepEqual([r.wing, r.how], ["nested", "basename-fallback"], r.out);
    },
  );
  test("CREWRIG_USAGE_WING -> env-override, no memo (still 3)", () => {
    const r = wing(sb, repo, { CREWRIG_USAGE_WING: "override-wing" });
    assert.deepEqual([r.wing, r.how], ["override-wing", "env-override"], r.out);
    assert.equal(memos(), 3);
  });
});

describe("(j) sidecar repair: missing and truncated sidecars", () => {
  const sample = path.join(REPO, "schemas", "usage-record", "samples", "claude-code.json");
  const rec = readRecord(sample);
  function setup(): { sb: Sandbox; entry: string; sidecar: string; expected: string } {
    const sb = fresh();
    assert.equal(writeRecord(sb, sample).state, "stored");
    const cli = rec.provenance.cli;
    const entry = entryPath(sb, cli, periodOf(rec), rec.recordId);
    assert.ok(fs.existsSync(entry), `setup: no journal entry at ${entry}`);
    const expected = wing(sb, "/home/agent/workspaces/crewrig").wing;
    return { sb, entry, sidecar: sidecarPath(sb, cli, periodOf(rec), rec.recordId), expected };
  }
  const repair = (s: ReturnType<typeof setup>) =>
    drive(s.sb, ["repair-sidecar", rec.provenance.cli, periodOf(rec), rec.recordId, s.entry]);
  const parses = (f: string): boolean => {
    try {
      JSON.parse(fs.readFileSync(f, "utf8"));
      return true;
    } catch {
      return false;
    }
  };

  test("a missing sidecar is re-derived, written, names the right wing and parses", () => {
    const s = setup();
    fs.rmSync(s.sidecar);
    const out = repair(s);
    assert.ok(fs.existsSync(s.sidecar), "repair did not recreate the sidecar");
    assert.ok(out.stdout.includes(`WING=${s.expected}`), out.stdout);
    assert.ok(parses(s.sidecar), "repaired sidecar does not parse");
  });

  test("a truncated sidecar is treated as missing and rewritten whole (rename, not EEXIST)", () => {
    const s = setup();
    const buf = fs.readFileSync(s.sidecar);
    fs.writeFileSync(s.sidecar, buf.subarray(0, Math.floor(buf.length / 2)));
    assert.equal(parses(s.sidecar), false, "setup: truncated sidecar still parses");
    const out = repair(s);
    assert.ok(out.stdout.includes(`WING=${s.expected}`), out.stdout);
    assert.ok(parses(s.sidecar), "torn sidecar was not replaced");
  });
});

const digest = (rel: string): string =>
  createHash("sha256")
    .update(fs.readFileSync(path.join(REPO, rel)))
    .digest("hex");

describe("MUT-1 journal.write() skipping the sidecar link", () => {
  const before = Object.fromEntries(
    ["scripts/lib/usage-store/journal.js", "scripts/lib/usage-store/mirror.js"].map((f) => [
      f,
      digest(f),
    ]),
  );
  const FILE = "scripts/lib/usage-store/journal.js";
  const MARKER = "const wingInfo = mirror.resolveWing(record.identity.projectRoot);";
  const rec = makeRecord({
    cli: "gemini-cli",
    session: "mutant-sidecar-session",
    idem: "mutant-sidecar-key",
    requestInstant: "2024-08-01T00:00:00.000Z",
  });

  test("MUTATION RED: entry stored with NO sidecar", () => {
    const copy = mutated(FILE, MARKER, `${MARKER} return { status };`);
    try {
      const sb = fresh(copy.root);
      assert.equal(writeRecord(sb, rec).state, "stored");
      assert.ok(fs.existsSync(entryPath(sb, "gemini-cli", periodOf(rec), rec.recordId)));
      assert.equal(
        fs.existsSync(sidecarPath(sb, "gemini-cli", periodOf(rec), rec.recordId)),
        false,
      );
    } finally {
      copy.dispose();
    }
  });

  test("green twin: the unmutated tree writes the sidecar", () => {
    const sb = fresh();
    assert.equal(writeRecord(sb, rec).state, "stored");
    assert.ok(fs.existsSync(sidecarPath(sb, "gemini-cli", periodOf(rec), rec.recordId)));
  });

  test("#1260 mutation helper never touches tracked tree", () => {
    const copy = copyTracked(REPO, [FILE]);
    try {
      assert.throws(() => applyMutation(copy, FILE, "no such marker text", "x"), /needle absent/);
    } finally {
      copy.dispose();
    }
    // Content comparison, not `git diff`: the worktree may legitimately carry edits.
    for (const [file, hash] of Object.entries(before)) {
      assert.equal(digest(file), hash, `a mutation changed tracked ${file}`);
    }
  });
});

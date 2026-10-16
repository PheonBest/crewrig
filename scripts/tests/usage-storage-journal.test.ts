// usage-storage-journal.test.ts — journal write contract of test-usage-storage.sh (spec 0260):
// (a) stored + entry + sidecar + valid, (b) duplicate, (c) correction, (d) mutants,
// (f) concurrency, (n) state dir.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import {
  countFiles,
  drive,
  entryPath,
  makeRecord,
  partitionDir,
  periodOf,
  readRecord,
  sandbox,
  sidecarPath,
  writeRecord,
  writeRecordAsync,
} from "./lib/usage-storage-rig.ts";
import { REPO } from "./lib/worktree-fixtures.ts";

const sb = sandbox();
after(() => sb.cleanup());

const samplesDir = path.join(REPO, "schemas", "usage-record", "samples");
const mutantsDir = path.join(REPO, "scripts", "tests", "fixtures", "usage-records", "mutants");
const jsonFiles = (dir: string): string[] =>
  fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
const samples = jsonFiles(samplesDir);
const mutants = jsonFiles(mutantsDir);
const sha = (f: string): string => createHash("sha256").update(fs.readFileSync(f)).digest("hex");

describe("(a) schema-valid batch: re-validation + exactly one sidecar per entry", () => {
  test("vacuity guard: samples directory is not empty", () => {
    assert.ok(samples.length > 0, "samples directory has zero files");
  });
  for (const name of samples) {
    test(`sample ${name} stored with entry, sidecar and valid re-validation`, () => {
      const file = path.join(samplesDir, name);
      const rec = readRecord(file);
      const out = writeRecord(sb, file);
      assert.match(out.stdout, /STATUS=stored/);
      const entry = entryPath(sb, rec.provenance.cli, periodOf(rec), rec.recordId);
      assert.ok(fs.existsSync(entry), `no journal entry at ${entry}`);
      assert.ok(
        fs.existsSync(sidecarPath(sb, rec.provenance.cli, periodOf(rec), rec.recordId)),
        "no .wing.json sidecar",
      );
      const v = spawnSync(
        process.execPath,
        [path.join(REPO, "scripts", "lib", "usage-record-validator.js"), entry],
        {
          encoding: "utf8",
          env: sb.env(),
        },
      );
      assert.equal(v.status, 0, v.stdout + v.stderr);
      assert.ok(`${v.stdout}${v.stderr}`.includes(": OK"));
    });
  }
});

describe("(b) rewriting the same batch: all duplicate", () => {
  for (const name of samples) {
    test(`rewriting sample ${name} returns duplicate`, () => {
      assert.match(writeRecord(sb, path.join(samplesDir, name)).stdout, /STATUS=duplicate/);
    });
  }
});

describe("(c) correction: corrected entry's bytes and mtime are untouched", () => {
  test("correction leaves base entry sha256 and mtimeMs unchanged", () => {
    const instant = new Date().toISOString();
    const base = makeRecord({
      session: "correction-base-session",
      idem: "correction-base-key",
      requestInstant: instant,
    });
    assert.equal(writeRecord(sb, base).state, "stored");
    const entry = entryPath(sb, "claude-code", periodOf(base), base.recordId);
    const before = { hash: sha(entry), mtime: fs.statSync(entry).mtimeMs };
    const corr = makeRecord({
      session: "correction-base-session",
      idem: "correction-base-key-corr-01",
      requestInstant: instant,
      corrects: base.recordId,
    });
    assert.equal(writeRecord(sb, corr).state, "stored");
    assert.ok(fs.existsSync(entryPath(sb, "claude-code", periodOf(corr), corr.recordId)));
    assert.equal(sha(entry), before.hash, "corrected entry's bytes CHANGED");
    assert.equal(fs.statSync(entry).mtimeMs, before.mtime, "corrected entry's mtime CHANGED");
  });
});

describe("(d) mutants: rejected with a reason, zero files under journal/ and mirror/", () => {
  test("vacuity guard: mutants directory is not empty", () => {
    assert.ok(mutants.length > 0, "mutants directory has zero files");
  });
  for (const name of mutants) {
    test(`mutant ${name} rejected with REASON= and zero files written`, () => {
      const j = countFiles(path.join(sb.root, "journal"));
      const m = countFiles(path.join(sb.root, "mirror"));
      const out = writeRecord(sb, path.join(mutantsDir, name));
      assert.equal(out.state, "rejected", out.stdout);
      assert.ok(out.stdout.includes("REASON="), out.stdout);
      assert.equal(countFiles(path.join(sb.root, "journal")), j, "journal/ file count changed");
      assert.equal(countFiles(path.join(sb.root, "mirror")), m, "mirror/ file count changed");
    });
  }
});

describe("(f) concurrency: 8 simultaneous writers to one partition", () => {
  const per = "2022-06";
  const instant = "2022-06-01T00:00:00.000Z";
  const mk = (tag: string, i: number) =>
    makeRecord({
      cli: "gemini-cli",
      session: `${tag}-session-${i}`,
      idem: `${tag}-key-${i}`,
      requestInstant: instant,
    });
  const dir = partitionDir(sb, "gemini-cli", per);
  const entries = (): string[] =>
    fs.readdirSync(dir).filter((f) => f.endsWith(".json") && !f.endsWith(".wing.json"));
  const wave1 = Array.from({ length: 8 }, (_, i) => mk("conc", i + 1));

  test("8 concurrent writers: all stored, 8 entries + 8 sidecars, each whole and named by recordId", async () => {
    const outs = await Promise.all(wave1.map((r) => writeRecordAsync(sb, r)));
    assert.deepEqual(
      outs.map((o) => o.state),
      Array(8).fill("stored"),
    );
    assert.equal(entries().length, 8);
    assert.equal(fs.readdirSync(dir).filter((f) => f.endsWith(".wing.json")).length, 8);
    for (const f of entries()) {
      const parsed = readRecord(path.join(dir, f));
      assert.equal(f.slice(0, -".json".length), parsed.recordId);
    }
  });

  test("replay wave: 2 duplicates + 6 new concurrently leave 14 entries", async () => {
    const fresh = Array.from({ length: 6 }, (_, i) => mk("conc-new", i + 1));
    const outs = await Promise.all(
      [...wave1.slice(0, 2), ...fresh].map((r) => writeRecordAsync(sb, r)),
    );
    assert.equal(outs.slice(0, 2).filter((o) => o.state === "duplicate").length, 2);
    assert.equal(outs.slice(2).filter((o) => o.state === "stored").length, 6);
    assert.equal(entries().length, 14);
  });
});

// (n) last: the state directory is never created by anything above.
describe("(n) state dir", () => {
  test("layout.stateDir() is <root>/state and it never exists", () => {
    const out = drive(sb, ["state-dir"]);
    assert.equal(out.stdout.trim(), path.join(sb.root, "state"));
    assert.equal(fs.existsSync(path.join(sb.root, "state")), false);
  });
});

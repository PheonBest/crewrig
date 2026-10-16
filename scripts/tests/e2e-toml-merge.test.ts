// e2e-toml-merge.test.ts — migrated from test-e2e-toml-merge.sh (spec 0261 R19). Locks ADR 0003
// Decision 2 merge semantics of tests/e2e/lib/toml_merge.ts: tables merge recursively, arrays
// append, scalars override, new keys graft in, a missing local passes defaults through, malformed
// defaults fail. No Docker, no shell, no jq/yq: runs on every platform.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import { tomlMerge } from "../../tests/e2e/lib/toml_merge.ts";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-toml-merge-"));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const ENV = { TMPDIR: os.tmpdir() };

function write(name: string, body: string): string {
  const p = path.join(TMP, name);
  fs.writeFileSync(p, body);
  return p;
}

function merge(...files: string[]) {
  return tomlMerge(files, TMP, ENV);
}

type CliTable = Record<string, unknown>;
interface MergedDoc {
  cli: Record<string, CliTable>;
}

function json(...files: string[]): MergedDoc {
  const r = merge(...files);
  assert.equal(r.rc, 0, r.stderr);
  return JSON.parse(r.stdout) as MergedDoc;
}

describe("e2e toml merge", () => {
  it("empty local: output equals defaults", () => {
    const d = write("c1-d.toml", '[cli.claude]\nimage = "X"\nmounts = ["a"]\n');
    const l = write("c1-l.toml", "");
    assert.deepEqual(json(d, l), json(d));
  });

  it("array APPEND preserves order [a,b]", () => {
    const d = write("c2-d.toml", '[cli.claude]\nmounts = ["a"]\n');
    const l = write("c2-l.toml", '[cli.claude]\nmounts = ["b"]\n');
    assert.deepEqual(json(d, l).cli.claude.mounts, ["a", "b"]);
  });

  it("scalar override: image replaced, sibling keys intact", () => {
    const d = write(
      "c3-d.toml",
      '[cli.claude]\nimage    = "X"\ncommand  = ["claude"]\nenv_keys = ["ANTHROPIC_API_KEY"]\n',
    );
    const l = write("c3-l.toml", '[cli.claude]\nimage = "Y"\n');
    const c = json(d, l).cli.claude;
    assert.equal(c.image, "Y");
    assert.deepEqual(c.command, ["claude"]);
    assert.deepEqual(c.env_keys, ["ANTHROPIC_API_KEY"]);
  });

  it("env_keys dedup preserves declaration order [Z,A,M] (spec 0079 R2)", () => {
    const d = write("c3b-d.toml", '[cli.claude]\nenv_keys = ["Z", "A"]\n');
    const l = write("c3b-l.toml", '[cli.claude]\nenv_keys = ["A", "M"]\n');
    assert.deepEqual(json(d, l).cli.claude.env_keys, ["Z", "A", "M"]);
  });

  it("key add: new keys and new tables grafted in", () => {
    const d = write("c4-d.toml", '[cli.claude]\nimage = "X"\n');
    const l = write("c4-l.toml", '[cli.claude]\nextra = "new"\n\n[cli.brand_new]\nimage = "Z"\n');
    const j = json(d, l);
    assert.equal(j.cli.claude.image, "X");
    assert.equal(j.cli.claude.extra, "new");
    assert.equal(j.cli.brand_new.image, "Z");
  });

  it("missing local: defaults as JSON, exit 0", () => {
    const d = write("c5-d.toml", '[cli.claude]\nimage = "X"\n');
    const nope = path.join(TMP, "does-not-exist.toml");
    assert.ok(!fs.existsSync(nope));
    assert.equal(json(d, nope).cli.claude.image, "X");
  });

  it("no local argument: defaults as JSON", () => {
    const d = write("c5b-d.toml", '[cli.claude]\nimage = "X"\n');
    assert.equal(json(d).cli.claude.image, "X");
  });

  it("malformed defaults: non-zero exit with an error on stderr", () => {
    const d = write("c6-d.toml", '[cli.claude\nimage = "X"\n');
    const r = merge(d);
    assert.notEqual(r.rc, 0);
    assert.notEqual(r.stderr, "");
  });

  it("missing defaults: non-zero exit with a clear 'not found' error", () => {
    const r = merge(path.join(TMP, "no-such-defaults.toml"));
    assert.notEqual(r.rc, 0);
    assert.match(r.stderr, /not found/);
  });

  it("no tmp residue: no d.json or l.json at the temp root after a clean run", () => {
    const d = write("c7-d.toml", '[cli.claude]\nimage = "X"\n');
    const l = write("c7-l.toml", '[cli.claude]\nimage = "Y"\n');
    const before = fs.readdirSync(TMP).length;
    assert.equal(merge(d, l).rc, 0);
    assert.equal(fs.readdirSync(TMP).length, before);
    assert.ok(!fs.existsSync(path.join(os.tmpdir(), "d.json")));
    assert.ok(!fs.existsSync(path.join(os.tmpdir(), "l.json")));
  });
});

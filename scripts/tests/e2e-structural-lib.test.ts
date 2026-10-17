// e2e-structural-lib.test.ts — regression for tests/e2e/lib/structural.ts (migrated from
// test-e2e-structural-lib.sh; spec 0261 R13, R19). Locks ADR 0004 Decisions 1, 3, 6:
// assert_stdout_matches (stdin or file form, ERE), assert_json_shape, assert_gitmoji_title.
// The twin spawns no jq and no GNU grep, so every case runs on every platform.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import type { AssertOptions, AssertResult } from "../../tests/e2e/lib/assert.ts";
import {
  assertGitmojiTitle,
  assertJsonShape,
  assertStdoutMatches,
} from "../../tests/e2e/lib/structural.ts";

let tmp = "";
let o: AssertOptions;

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-structural-lib-"));
  o = { cwd: tmp, env: {} };
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function pass(r: AssertResult): void {
  assert.equal(r.rc, 0);
  assert.equal(r.stderr, "");
}
function failing(r: AssertResult, name: RegExp | string): void {
  assert.notEqual(r.rc, 0);
  if (typeof name === "string") assert.ok(r.stderr.includes(name), r.stderr);
  else assert.match(r.stderr, name);
}

describe("structural.ts", () => {
  it("assert_stdout_matches stdin: match -> PASS, miss -> FAIL+diag", () => {
    pass(assertStdoutMatches("^alpha-", "", "alpha-line\n", o));
    failing(assertStdoutMatches("^zzz$", "", "alpha-line\n", o), /^# FAIL assert_stdout_matches/m);
  });

  it("assert_stdout_matches file: match -> PASS, absent -> FAIL+diag", () => {
    fs.writeFileSync(path.join(tmp, "fx"), "gamma\n");
    pass(assertStdoutMatches("^gamma$", "fx", "", o));
    failing(assertStdoutMatches("x", "nope", "", o), "no such file");
  });

  it("assert_json_shape: {} matches '.', .a == 1, mismatch, absent", () => {
    fs.writeFileSync(path.join(tmp, "empty.json"), "{}\n");
    fs.writeFileSync(path.join(tmp, "one.json"), '{"a":1}\n');
    pass(assertJsonShape("empty.json", ".", "{}", o));
    pass(assertJsonShape("one.json", ".a", "1", o));
    failing(assertJsonShape("one.json", ".a", "2", o), /^# FAIL assert_json_shape/m);
    failing(assertJsonShape("missing.json", ".", "{}", o), "no such file");
  });

  it("assert_gitmoji_title: 2 positive + 2 negative", () => {
    pass(assertGitmojiTitle("🐳 Add docker", o));
    pass(assertGitmojiTitle("✨ Initial commit", o));
    failing(assertGitmojiTitle("Add foo", o), /^# FAIL assert_gitmoji_title/m);
    failing(assertGitmojiTitle("🐳", o), /^# FAIL assert_gitmoji_title/m);
  });
});

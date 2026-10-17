// e2e-assert-lib.test.ts — regression for tests/e2e/lib/assert.ts (migrated from
// test-e2e-assert-lib.sh; spec 0261 R13, R19). Locks ADR 0004 Decisions 1, 2, 6: PASS is silent,
// FAIL emits a `# FAIL <name>` block with expected/actual, MemPalace probes preflight the binary,
// and `assert_git_branch_pushed` checks a remote ref via ls-remote.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import {
  assertDrawerField,
  assertDrawerPresent,
  assertExitCode,
  assertFileAbsent,
  assertFileContains,
  assertFileExists,
  assertGitBranchPushed,
  type AssertOptions,
  type AssertResult,
} from "../../tests/e2e/lib/assert.ts";
import { findOnPath } from "../../tests/e2e/lib/exec.ts";

let tmp = "";
let o: AssertOptions;
const diags: string[] = [];

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-assert-lib-"));
  // An empty PATH directory so the mempalace preflight is deterministic.
  fs.mkdirSync(path.join(tmp, "emptybin"));
  o = { cwd: tmp, env: { PATH: path.join(tmp, "emptybin") } };
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
  diags.push(r.stderr);
}

describe("assert.ts", () => {
  it("assert_file_exists: PASS is silent, missing -> FAIL+diag", () => {
    fs.writeFileSync(path.join(tmp, "present"), "");
    pass(assertFileExists("present", o));
    failing(assertFileExists("absent", o), /^# FAIL assert_file_exists/m);
  });

  it("assert_file_contains: match, no match, absent file", () => {
    fs.writeFileSync(path.join(tmp, "hay"), "alpha\nbeta\n");
    pass(assertFileContains("hay", "^beta$", o));
    failing(assertFileContains("hay", "^zzz$", o), /^# FAIL assert_file_contains/m);
    failing(assertFileContains("absent", "x", o), "no such file");
  });

  it("assert_file_absent: missing -> PASS, present -> FAIL+diag", () => {
    pass(assertFileAbsent("absent", o));
    failing(assertFileAbsent("present", o), /^# FAIL assert_file_absent/m);
  });

  it("assert_exit_code: equal -> PASS, differ -> FAIL+diag", () => {
    pass(assertExitCode("0", "0", o));
    failing(assertExitCode("0", "1", o), /^# FAIL assert_exit_code/m);
  });

  it("assert_git_branch_pushed: existing -> PASS, absent -> FAIL+diag", (t) => {
    if (findOnPath("git", process.env as Record<string, string>) === null) {
      t.skip("git not on PATH");
      return;
    }
    const bare = path.join(tmp, "remote.git");
    const work = path.join(tmp, "work");
    const git = (cwd: string, ...a: string[]) =>
      spawnSync("git", a, {
        cwd,
        encoding: "utf8",
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
    fs.mkdirSync(bare);
    fs.mkdirSync(work);
    assert.equal(git(bare, "init", "--bare", "-q", "-b", "main").status, 0);
    git(work, "init", "-q", "-b", "main");
    git(
      work,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@e",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "x",
    );
    git(work, "remote", "add", "crewrig", bare);
    assert.equal(git(work, "push", "-q", "crewrig", "main").status, 0);
    const go: AssertOptions = { cwd: work, env: process.env as Record<string, string> };
    pass(assertGitBranchPushed("crewrig", "main", go));
    failing(
      assertGitBranchPushed("crewrig", "__no_such_branch_zzz__", go),
      /^# FAIL assert_git_branch_pushed/m,
    );
  });

  it("assert_drawer_present / assert_drawer_field: no binary -> FAIL+diag", () => {
    failing(assertDrawerPresent("some-wing", "some-room", "foo", o), "mempalace binary not found");
    failing(
      assertDrawerField("some-wing", "some-room", "some-key", "writer_agent", "claude", o),
      "mempalace binary not found",
    );
  });

  it("diag-block uniformity (# FAIL / expected / actual)", () => {
    const all = diags.join("");
    const count = (re: RegExp) => (all.match(re) ?? []).length;
    const fails = count(/^# FAIL /gm);
    assert.ok(fails >= 5, `fails=${fails}`);
    assert.equal(count(/^#   expected:/gm), fails);
    assert.equal(count(/^#   actual:/gm), fails);
  });
});

// worktree-claim-bash-port-basic.test.ts — cases 1-8 and 15 of the retired
// scripts/tests/test-worktree-claim.sh (spec 0260, row J1a), plus the
// `run` ledger row of case 10. Each test owns a fresh fixture: claim state
// leaks across cases otherwise. The shell diagnostics of the Bash oracle were
// read from stdout, so the same streams are asserted here.

import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import { claim, ledgerHas, ledgerLacks, sameBytes } from "./lib/worktree-claim-asserts.ts";
import {
  CLAIM_SH,
  SKIP_POSIX,
  cleanEnv,
  cleanupAll,
  makeFixture,
  realTmp,
} from "./lib/worktree-fixtures.ts";

after(cleanupAll);

const append = (file: string, text: string): void => fs.appendFileSync(file, text);

describe("worktree-claim bash port: basic", () => {
  test("case 1: take on a clean worktree claims it, status and ledger agree", () => {
    const fx = makeFixture();
    const take = claim(fx, ["take", "--agent", "alice", "--operation", "git reset --hard"]);
    assert.equal(take.status, 0, take.stderr);
    assert.match(take.stdout, /Claimed '736' for 'alice'\./);
    assert.ok(fs.statSync(fx.claimDir).isDirectory(), "claim dir under the common dir");
    const st = claim(fx, ["status"]);
    assert.equal(st.status, 0);
    assert.match(st.stdout, /state: claimed/);
    assert.match(st.stdout, /holder: alice/);
    assert.match(st.stdout, /operation: git reset --hard/);
    ledgerHas(fx, /^[^\t]*\ttake\talice\t736/);
  });

  test(
    "case 1 (shim leg): the bash shim takes and reports the same claim",
    { skip: SKIP_POSIX },
    () => {
      const fx = makeFixture();
      const run = (args: string[]) =>
        spawnSync("bash", [CLAIM_SH, ...args], { cwd: fx.wt, env: cleanEnv(), encoding: "utf8" });
      const take = run(["take", "--agent", "alice"]);
      assert.equal(take.status, 0, take.stderr);
      assert.match(take.stdout, /Claimed '736' for 'alice'\./);
      assert.match(run(["status"]).stdout, /holder: alice/);
    },
  );

  test("case 2: second take by another agent exits 4 and keeps the incumbent", () => {
    const fx = makeFixture();
    assert.equal(claim(fx, ["take", "--agent", "alice"]).status, 0);
    const second = claim(fx, ["take", "--agent", "bob"]);
    assert.equal(second.status, 4);
    assert.match(second.stdout, /already claimed by another agent/);
    assert.match(second.stdout, /holder: alice/);
    assert.match(claim(fx, ["status"]).stdout, /holder: alice/);
  });

  test("case 3: dirty tracked file exits 5 before any claim or ledger exists", () => {
    const fx = makeFixture();
    append(path.join(fx.wt, "tracked.txt"), "modified by a sibling agent\n");
    const res = claim(fx, ["take", "--agent", "alice"]);
    assert.equal(res.status, 5);
    assert.match(res.stdout, /carries uncommitted changes/);
    assert.match(res.stdout, /M tracked\.txt/);
    assert.equal(fs.existsSync(fx.claimDir), false, "no claim dir");
    assert.equal(fs.existsSync(fx.ledger), false, "no ledger");
  });

  test("case 4: an untracked file in an untracked directory is named in full", () => {
    const fx = makeFixture();
    fs.mkdirSync(path.join(fx.wt, "newdir", "nested"), { recursive: true });
    fs.writeFileSync(path.join(fx.wt, "newdir", "nested", "f.txt"), "unattributable\n");
    const res = claim(fx, ["take", "--agent", "alice"]);
    assert.equal(res.status, 5);
    assert.match(res.stdout, /\?\? newdir\/nested\/f\.txt/);
    assert.ok(!res.stdout.split("\n").includes("?? newdir/"), "not collapsed to `?? newdir/`");
    assert.equal(fs.existsSync(fx.claimDir), false);
  });

  test("case 5: holder release frees the worktree for another agent", () => {
    const fx = makeFixture();
    assert.equal(claim(fx, ["take", "--agent", "alice"]).status, 0);
    assert.equal(claim(fx, ["release", "--agent", "alice"]).status, 0);
    assert.equal(fs.existsSync(fx.claimDir), false);
    const bob = claim(fx, ["take", "--agent", "bob"]);
    assert.equal(bob.status, 0);
    assert.match(bob.stdout, /holder: bob/);
  });

  test("case 6: release by a non-holder exits 4 and the claim survives", () => {
    const fx = makeFixture();
    assert.equal(claim(fx, ["take", "--agent", "alice"]).status, 0);
    const res = claim(fx, ["release", "--agent", "bob"]);
    assert.equal(res.status, 4);
    assert.match(res.stdout, /held by 'alice', not by 'bob'/);
    assert.ok(fs.statSync(fx.claimDir).isDirectory());
  });

  test("case 7: history after release lists a timestamped release line and two entries", () => {
    const fx = makeFixture();
    assert.equal(
      claim(fx, ["take", "--agent", "alice", "--operation", "verification run"]).status,
      0,
    );
    assert.equal(claim(fx, ["release", "--agent", "alice"]).status, 0);
    assert.equal(fs.existsSync(fx.claimDir), false);
    const hist = claim(fx, ["history"]);
    assert.equal(hist.status, 0);
    assert.match(hist.stdout, /alice/);
    assert.match(hist.stdout, /release/);
    assert.match(hist.stdout, /entries: 2/);
    assert.match(hist.stdout, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ\trelease\talice/m);
  });

  test("case 8: takeover is refused while fresh, succeeds at --stale-after 0, residue untouched", () => {
    const fx = makeFixture();
    assert.equal(claim(fx, ["take", "--agent", "alice"]).status, 0);
    const tracked = path.join(fx.wt, "tracked.txt");
    const residue = path.join(fx.wt, "residue.txt");
    append(tracked, "ninety lines of uncommitted work\n");
    fs.writeFileSync(residue, "and a file git never knew about\n");
    const outside = realTmp("crewrig-claim-expected-");
    fs.copyFileSync(tracked, path.join(outside, "tracked.expected"));
    fs.copyFileSync(residue, path.join(outside, "residue.expected"));

    const fresh = claim(fx, ["takeover", "--agent", "bob"]);
    assert.equal(fresh.status, 4);
    assert.match(fresh.stdout, /not stale/);
    assert.match(fresh.stdout, /holder: alice/);

    const took = claim(fx, ["takeover", "--agent", "bob", "--stale-after", "0"]);
    assert.equal(took.status, 0, took.stderr);
    assert.match(took.stdout, /Took over '736' from 'alice'/);
    assert.match(took.stdout, /holder: bob/);
    ledgerHas(fx, /\ttakeover\tbob\t736\tdisplaced=alice/);
    sameBytes(tracked, path.join(outside, "tracked.expected"), "tracked residue rewritten");
    sameBytes(residue, path.join(outside, "residue.expected"), "untracked residue rewritten");
  });

  test("case 10 (run row): run releases on both outcomes and tags the ledger", () => {
    const fx = makeFixture();
    const ok = claim(fx, ["run", "--agent", "alice", "--", process.execPath, "-e", "0"]);
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(fs.existsSync(fx.claimDir), false);
    // a fresh claim, then a failing command: the exit status is passed through
    assert.equal(
      claim(fx, ["run", "--agent", "alice", "--", process.execPath, "-e", "process.exit(42)"])
        .status,
      42,
    );
    assert.equal(fs.existsSync(fx.claimDir), false);
    ledgerHas(fx, /\trelease\talice\t736\trun/);
    assert.equal(claim(fx, ["take", "--agent", "bob"]).status, 0);
    ledgerLacks(fx, /\tdisplaced=/);
  });

  test("case 15: takeover on an unclaimed worktree exits 4 and creates nothing", () => {
    const fx = makeFixture();
    append(path.join(fx.wt, "tracked.txt"), "dirt that take would refuse\n");
    const res = claim(fx, ["takeover", "--agent", "bob", "--stale-after", "0"]);
    assert.equal(res.status, 4);
    assert.match(res.stdout, /not claimed/);
    assert.match(res.stdout, /take/);
    assert.equal(fs.existsSync(fx.claimDir), false);
  });
});

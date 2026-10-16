// worktree-claim-bash-port-guards.test.ts — cases 9, 11-14, 16, 23 and 24 of
// the retired scripts/tests/test-worktree-claim.sh (spec 0260, row J1a).
// Wrapped commands and the case-16 interloper are `node -e` programs, so the
// file runs on every platform; the shim leg and the symlink arm are POSIX-only.
// Case 9 (survival of `git clean -fdx`) had no TypeScript twin before this port.

import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import { claim, ledgerHas, ledgerLacks, sameBytes } from "./lib/worktree-claim-asserts.ts";
import {
  CLAIM_SH,
  CLAIM_TS,
  SKIP_POSIX,
  cleanEnv,
  cleanupAll,
  makeFixture,
  realTmp,
} from "./lib/worktree-fixtures.ts";

after(cleanupAll);

const NODE = process.execPath;

describe("worktree-claim bash port: guards", () => {
  test("case 9: the claim survives `git clean -fdx` run inside the worktree", () => {
    const fx = makeFixture();
    assert.equal(claim(fx, ["take", "--agent", "alice"]).status, 0);
    const doomed = path.join(fx.wt, "doomed.txt");
    fs.writeFileSync(doomed, "about to be destroyed\n");
    fx.git(["clean", "-fdxq"], fx.wt);
    assert.equal(fs.existsSync(doomed), false, "git clean must have teeth: doomed.txt is gone");
    assert.ok(fs.statSync(fx.claimDir).isDirectory(), "claim dir survives the clean");
    const st = claim(fx, ["status"]);
    assert.equal(st.status, 0);
    assert.match(st.stdout, /state: claimed/);
    assert.match(st.stdout, /holder: alice/);
  });

  test("case 11: status and history answer from the main checkout after the worktree is removed", () => {
    const fx = makeFixture();
    assert.equal(claim(fx, ["take", "--agent", "alice"]).status, 0);
    assert.equal(claim(fx, ["release", "--agent", "alice"]).status, 0);
    fx.git(["worktree", "remove", fx.wt]);
    assert.equal(fs.existsSync(fx.wt), false, "worktree really removed");

    const hist = claim(fx, ["history", "--ticket", fx.ticket], { cwd: fx.main });
    assert.equal(hist.status, 0, hist.stderr);
    assert.match(hist.stdout, /alice/);
    assert.match(hist.stdout, /entries: 2/);

    const st = claim(fx, ["status", "--ticket", fx.ticket], { cwd: fx.main });
    assert.equal(st.status, 0, st.stderr);
    assert.match(st.stdout, /state: unclaimed/);
    assert.match(st.stdout, /last-holder: alice/);
    assert.match(st.stdout, /last-action: release/);
    assert.match(st.stdout, /^last-at: \d{4}-\d\d-\d\dT/m);

    // no --ticket and none derivable: refused, naming the flag
    const bare = claim(fx, ["history"], { cwd: fx.main });
    assert.equal(bare.status, 1);
    assert.match(bare.stdout + bare.stderr, /--ticket/);

    // CREWRIG_REPO_DIR override, from outside any repository
    const outside = realTmp("crewrig-claim-outside-");
    const env = cleanEnv({ CREWRIG_REPO_DIR: fx.main });
    const viaEnv = claim(fx, ["status", "--ticket", fx.ticket], { cwd: outside, env });
    assert.equal(viaEnv.status, 0, viaEnv.stderr);
    assert.match(viaEnv.stdout, /last-holder: alice/);
  });

  test("case 12: the claim root is one physical string across four cwds", () => {
    const fx = makeFixture();
    const cwds = [fx.wt, path.join(fx.wt, "sub")];
    if (fx.link === null) {
      // symlink arm unavailable on this host; the physical arms still run
    } else {
      cwds.unshift(path.join(fx.link, "repo"), path.join(fx.link, "repo", "sub"));
    }
    if (process.platform !== "win32") {
      assert.equal(cwds.length, 4, "the symlink arms must run on POSIX hosts");
    }
    for (const cwd of cwds) {
      const res = claim(fx, ["status", "--ticket", fx.ticket], { cwd });
      assert.equal(res.status, 0, `${cwd}: ${res.stderr}`);
      const seen = /^claim-root: (.*)$/m.exec(res.stdout)?.[1];
      assert.equal(seen, fx.claimRoot, `claim-root from ${cwd}`);
    }
  });

  test("case 13: a takeover grants no clean-tree waiver; a real `git reset --hard` is refused", () => {
    const fx = makeFixture();
    assert.equal(claim(fx, ["take", "--agent", "alice"]).status, 0);
    const tracked = path.join(fx.wt, "tracked.txt");
    fs.appendFileSync(tracked, "uncommitted work alice never got to commit\n");
    const outside = realTmp("crewrig-claim-expected-");
    const expected = path.join(outside, "tracked.expected");
    fs.copyFileSync(tracked, expected);

    const took = claim(fx, ["takeover", "--agent", "bob", "--stale-after", "0"]);
    assert.equal(took.status, 0, took.stderr);
    assert.match(took.stdout, /holder: bob/);

    const run = claim(fx, ["run", "--agent", "bob", "--", "git", "reset", "--hard"]);
    assert.equal(run.status, 5);
    assert.match(run.stdout, /carries uncommitted changes/);
    sameBytes(tracked, expected, "git reset --hard destroyed the residue");
    assert.match(claim(fx, ["status"]).stdout, /holder: bob/);
  });

  test("case 14: run is re-entrant for the holder and does not release it", () => {
    const fx = makeFixture();
    assert.equal(claim(fx, ["take", "--agent", "alice"]).status, 0);
    const run = claim(fx, ["run", "--agent", "alice", "--", NODE, "-e", "0"]);
    assert.equal(run.status, 0, run.stderr);
    assert.ok(fs.statSync(fx.claimDir).isDirectory(), "claim survives the re-entrant run");
    ledgerHas(fx, new RegExp(`\\trun-reentrant\\talice\\t${fx.ticket}`));
    const bob = claim(fx, ["take", "--agent", "bob"]);
    assert.equal(bob.status, 4);
    assert.match(bob.stdout, /holder: alice/);
    ledgerLacks(fx, new RegExp(`\\trelease\\talice\\t${fx.ticket}`));
  });

  test("case 14 (shim leg): the bash shim is re-entrant the same way", { skip: SKIP_POSIX }, () => {
    const fx = makeFixture();
    const sh = (args: string[]) =>
      spawnSync("bash", [CLAIM_SH, ...args], { cwd: fx.wt, env: cleanEnv(), encoding: "utf8" });
    assert.equal(sh(["take", "--agent", "alice"]).status, 0);
    assert.equal(sh(["run", "--agent", "alice", "--", NODE, "-e", "0"]).status, 0);
    assert.ok(fs.statSync(fx.claimDir).isDirectory());
  });

  test("case 16: a takeover landing inside an in-flight run survives the run's exit", () => {
    const fx = makeFixture();
    const aged = Math.floor(Date.now() / 1000) - 3600;
    // The interloper back-dates since_epoch, then takes over at the default threshold.
    const code = [
      "const { spawnSync } = require('node:child_process');",
      "const fs = require('node:fs');",
      "const [dir, aged, claimTs] = process.argv.slice(1);",
      "fs.writeFileSync(dir + '/since_epoch', aged + '\\n');",
      "const r = spawnSync(process.execPath, [claimTs, 'takeover', '--agent', 'bob'], { stdio: 'inherit' });",
      "process.exit(r.status ?? 1);",
    ].join("\n");
    const run = claim(fx, [
      "run",
      "--agent",
      "alice",
      "--",
      NODE,
      "-e",
      code,
      fx.claimDir,
      String(aged),
      CLAIM_TS,
    ]);
    assert.match(run.stdout, new RegExp(`Took over '${fx.ticket}' from 'alice'`));
    assert.equal(run.status, 0, run.stderr);

    assert.ok(fs.statSync(fx.claimDir).isDirectory(), "bob's claim outlives the run");
    const st = claim(fx, ["status"]);
    assert.equal(st.status, 0);
    assert.match(st.stdout, /state: claimed/);
    assert.match(st.stdout, /holder: bob/);
    const carol = claim(fx, ["take", "--agent", "carol"]);
    assert.equal(carol.status, 4);
    assert.match(carol.stdout, /holder: bob/);
    ledgerLacks(fx, new RegExp(`\\trelease\\talice\\t${fx.ticket}`));
    ledgerHas(fx, new RegExp(`\\ttakeover\\tbob\\t${fx.ticket}\\tdisplaced=alice`));
  });

  test("case 23: CREWRIG_REPO_DIR picks the tree `run` mutates, not the caller's cwd", () => {
    const a = makeFixture();
    const b = makeFixture();
    const touch = "require('node:fs').writeFileSync('marker.txt', '')";
    const res = claim(a, ["run", "--agent", "alice", "--", NODE, "-e", touch], {
      cwd: b.wt,
      env: cleanEnv({ CREWRIG_REPO_DIR: a.wt }),
    });
    assert.equal(res.status, 0, res.stderr);
    assert.ok(fs.existsSync(path.join(a.wt, "marker.txt")), "marker in the certified tree A");
    assert.equal(fs.existsSync(path.join(b.wt, "marker.txt")), false, "no marker in caller tree B");
  });

  test("case 24: a run from a subdirectory executes at the worktree root", () => {
    const fx = makeFixture();
    const res = claim(
      fx,
      ["run", "--agent", "alice", "--", NODE, "-e", "console.log(process.cwd())"],
      {
        cwd: fx.sub,
      },
    );
    assert.equal(res.status, 0, res.stderr);
    // equality, not substring: the root is a prefix of the subdirectory
    assert.equal(fs.realpathSync.native(res.stdout.trim()), fs.realpathSync.native(fx.wt));
    assert.notEqual(fs.realpathSync.native(res.stdout.trim()), fs.realpathSync.native(fx.sub));
  });
});

// worktree-claim-bash-port-arith.test.ts — cases 17-22 of the retired
// scripts/tests/test-worktree-claim.sh (spec 0260, row J1a): the arithmetic
// edges of `takeover` (`--stale-after` width and leading zeros, hostile
// `since_epoch` values) and the value-less flag diagnostic. Each assertion
// pins the VALUE (480, `held-for-seconds: 0`, the echoed number), not only
// the exit status. Every test owns a fresh fixture. The Bash `want_any`
// read stdout and stderr together, so `both()` does the same.

import assert from "node:assert/strict";
import fs from "node:fs";
import { after, describe, test } from "node:test";

import { claim, ledgerHas, ledgerLacks, plantSince } from "./lib/worktree-claim-asserts.ts";
import { cleanupAll, makeFixture, nowEpoch, type Result } from "./lib/worktree-fixtures.ts";

after(cleanupAll);

const both = (res: Result): string => `${res.stdout}\n${res.stderr}`;
// What bash prints when its own arithmetic breaks (case 17/19 `want_no_shell_error`).
const SHELL_ERROR = /value too great for base|syntax error|unbound variable|bad substitution/i;
const noShellError = (res: Result): void => assert.doesNotMatch(both(res), SHELL_ERROR);

function claimed(): ReturnType<typeof makeFixture> {
  const fx = makeFixture();
  const take = claim(fx, ["take", "--agent", "alice"]);
  assert.equal(take.status, 0, take.stderr);
  return fx;
}

const takenOver = (fx: ReturnType<typeof makeFixture>): void => {
  ledgerHas(fx, new RegExp(`^[^\\t]*\\ttakeover\\tbob\\t${fx.ticket}\\tdisplaced=alice`));
};

const noTakeoverLedger = (fx: ReturnType<typeof makeFixture>): void =>
  ledgerLacks(fx, new RegExp(`\\ttakeover\\tbob\\t${fx.ticket}`));

describe("worktree-claim bash port: arithmetic edges", () => {
  // case 17
  test("case 17: --stale-after 08 is decimal 8 minutes: refused as not stale, 480 seconds", () => {
    const fx = claimed();
    const res = claim(fx, ["takeover", "--agent", "bob", "--stale-after", "08"]);
    assert.equal(res.status, 4, both(res));
    assert.match(res.stdout, /not stale/);
    assert.match(res.stdout, /stale-after-seconds: 480/);
    noShellError(res);
    const st = claim(fx, ["status"]);
    assert.equal(st.status, 0);
    assert.match(st.stdout, /holder: alice/);
    noTakeoverLedger(fx);
  });

  // case 18: three independent over-wide values, one fixture (as the Bash case)
  test("case 18: over-wide --stale-after values are out of range and echoed verbatim", () => {
    const fx = claimed();
    for (const value of [
      "200000000000000000", // wraps a signed 64-bit multiply
      "999999999999999999999", // 21 digits, beyond any integer width
      "307445734561825861", // 60 * value wraps to a small positive number
    ]) {
      const res = claim(fx, ["takeover", "--agent", "bob", "--stale-after", value]);
      assert.equal(res.status, 1, `--stale-after ${value}: ${both(res)}`);
      assert.match(both(res), /is out of range/, `--stale-after ${value}`);
      assert.ok(both(res).includes(value), `--stale-after ${value}: value not echoed`);
      noShellError(res);
    }
    assert.ok(fs.statSync(fx.claimDir).isDirectory(), "claim untouched");
    const st = claim(fx, ["status"]);
    assert.equal(st.status, 0);
    assert.match(st.stdout, /holder: alice/);
    noTakeoverLedger(fx);
  });

  // case 19
  test("case 19: since_epoch `08` is read as decimal 8 (infinitely old): takeover succeeds", () => {
    const fx = claimed();
    plantSince(fx, "08");
    const res = claim(fx, ["takeover", "--agent", "bob"]);
    assert.equal(res.status, 0, both(res));
    assert.match(res.stdout, new RegExp(`Took over '${fx.ticket}' from 'alice'`));
    assert.match(res.stdout, /holder: bob/);
    noShellError(res);
    takenOver(fx);
  });

  // case 20
  test("case 20: since_epoch = 2^64 + now (20 digits) is not mistaken for a fresh claim", () => {
    const fx = claimed();
    // 2^64 = 18446744073709551616; built by string concat, never as a Number (> 2^53).
    const wide = `1844674407${3709551616 + nowEpoch()}`;
    assert.equal(wide.length, 20, `fixture value ${wide} is not the 20-digit 2^64+now`);
    plantSince(fx, wide);
    const res = claim(fx, ["takeover", "--agent", "bob"]);
    assert.equal(res.status, 0, both(res));
    assert.match(res.stdout, new RegExp(`Took over '${fx.ticket}' from 'alice'`));
    assert.match(res.stdout, /holder: bob/);
    takenOver(fx);
  });

  // case 21: three independent arms, each with its own fixture
  describe("case 21: a since_epoch in the future", () => {
    test("case 21 skew: now+300 is clock skew, held for 0 seconds, refused as not stale", () => {
      const fx = claimed();
      plantSince(fx, String(nowEpoch() + 300));
      const res = claim(fx, ["takeover", "--agent", "bob"]);
      assert.equal(res.status, 4, both(res));
      assert.match(res.stdout, /not stale/);
      assert.match(res.stdout, /held-for-seconds: 0/);
      assert.match(claim(fx, ["status"]).stdout, /holder: alice/);
      noTakeoverLedger(fx);
    });

    test("case 21 corrupt: now+900 is beyond the skew band, treated as corrupt: takeover", () => {
      const fx = claimed();
      plantSince(fx, String(nowEpoch() + 900));
      const res = claim(fx, ["takeover", "--agent", "bob"]);
      assert.equal(res.status, 0, both(res));
      assert.match(res.stdout, new RegExp(`Took over '${fx.ticket}' from 'alice'`));
      assert.match(res.stdout, /holder: bob/);
      takenOver(fx);
    });

    test("case 21 wide: an 18-digit since_epoch is corrupt, not a far-future claim: takeover", () => {
      const fx = claimed();
      plantSince(fx, "100000000000000000");
      const res = claim(fx, ["takeover", "--agent", "bob"]);
      assert.equal(res.status, 0, both(res));
      assert.match(res.stdout, new RegExp(`Took over '${fx.ticket}' from 'alice'`));
      assert.match(res.stdout, /holder: bob/);
    });
  });

  // case 22
  test("case 22: `take --agent` with the value missing is refused", () => {
    const fx = makeFixture();
    const res = claim(fx, ["take", "--agent"]);
    assert.equal(res.status, 1, both(res));
    assert.match(both(res), /'--agent' requires a value/);
  });
});

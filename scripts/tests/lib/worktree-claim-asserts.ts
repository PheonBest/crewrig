// worktree-claim-asserts.ts — assertion helpers shared by the ported
// worktree-claim suites (spec 0260, section `test-worktree-claim.sh`).
//
// They sit on top of `worktree-fixtures.ts` (`makeFixture`, `runClaim`) and
// mirror the helper vocabulary of the Bash oracle: `want_ledger`,
// `want_no_ledger`, the since_epoch back-dating done by hand, and `cmp`.
//
// Standard library only.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  cleanEnv,
  runClaim,
  type Fixture,
  type Result,
  type RunOptions,
} from "./worktree-fixtures.ts";

/** Run the claim tool (TS entry) from `options.cwd` (default: the fixture worktree), env scrubbed. */
export function claim(
  fx: Pick<Fixture, "wt">,
  args: readonly string[],
  options: RunOptions = {},
): Result {
  return runClaim(args, { cwd: fx.wt, env: cleanEnv(), ...options });
}

/** The ledger text; fails when the ledger does not exist at all. */
export function ledgerText(fx: Pick<Fixture, "ledger">): string {
  assert.ok(fs.existsSync(fx.ledger), `ledger ${fx.ledger} must exist`);
  return fs.readFileSync(fx.ledger, "utf8");
}

/** Assert that some ledger line matches `re` (a RegExp is tested per line, multiline). */
export function ledgerHas(fx: Pick<Fixture, "ledger">, re: RegExp, label = ""): void {
  const text = ledgerText(fx);
  assert.match(
    text,
    new RegExp(re.source, re.flags.includes("m") ? re.flags : `${re.flags}m`),
    label || `ledger lacks ${re}`,
  );
}

/**
 * Assert that no ledger line matches `re`. Fails when the ledger is absent:
 * an absent ledger would make the assertion vacuous (Bash `want_no_ledger`).
 */
export function ledgerLacks(fx: Pick<Fixture, "ledger">, re: RegExp, label = ""): void {
  const text = ledgerText(fx);
  assert.doesNotMatch(
    text,
    new RegExp(re.source, re.flags.includes("m") ? re.flags : `${re.flags}m`),
    label || `ledger has ${re}`,
  );
}

/** Overwrite the claim's `since_epoch` file with `text` (one line, LF). */
export function plantSince(fx: Pick<Fixture, "claimDir">, text: string): void {
  fs.writeFileSync(path.join(fx.claimDir, "since_epoch"), `${text}\n`);
}

/** Assert that two files hold identical bytes (Bash `cmp -s`). */
export function sameBytes(a: string, b: string, label = ""): void {
  assert.ok(
    Buffer.compare(fs.readFileSync(a), fs.readFileSync(b)) === 0,
    label || `${a} and ${b} differ`,
  );
}

/** The `key: value` lines of a `status` output as a map (last wins). */
export function statusLines(stdout: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of stdout.split("\n")) {
    const m = /^([a-z-]+): ?(.*)$/.exec(line);
    if (m) out[m[1] as string] = m[2] as string;
  }
  return out;
}

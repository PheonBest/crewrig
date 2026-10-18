// capability.ts — the CI-aware skip rule of spec 0260 (requirement 8, plan step X3).
// A prerequisite that the CI runner image provides (node:sqlite, `ssh-keygen -Y
// sign`, a Git with SHA-256, `bash`) makes a test FAIL when `CI` is set, and skip with
// a stated reason otherwise: a test skipped in CI proves nothing. A POSIX-only leg
// skips on win32 whether or not `CI` is set (the Windows runner sets `CI`).

import assert from "node:assert/strict";
import type { TestContext } from "node:test";

export interface CapabilityOptions {
  /** The leg needs a POSIX shell, permission bits or signals: skip on win32. */
  readonly posixOnly?: boolean;
}

/**
 * Returns true when the test may go on. Order of evaluation: (1) a POSIX-only leg on
 * win32 skips; (2) a present capability continues; (3) an absent capability under `CI`
 * fails the test; (4) an absent capability elsewhere skips.
 */
export function requireOrSkip(
  t: TestContext,
  ok: boolean,
  reason: string,
  options: CapabilityOptions = {},
): boolean {
  if (options.posixOnly === true && process.platform === "win32") {
    t.skip(`SKIP: POSIX-only leg (${reason})`);
    return false;
  }
  if (ok) return true;
  const ci = process.env.CI;
  if (ci !== undefined && ci !== "" && ci !== "0" && ci !== "false") {
    assert.fail(`required capability missing in CI: ${reason}`);
  }
  t.skip(`SKIP: ${reason}`);
  return false;
}

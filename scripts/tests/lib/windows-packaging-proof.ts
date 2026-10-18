// windows-packaging-proof.ts — the cross-system proof of the six packaging and release entries (spec
// 0257 R27, parent R17). Not a test suite: a script the `windows-packaging-entries` job runs, and
// that also passes on POSIX (the entry then runs directly), so its assertions are the same on both.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/tests/lib/windows-packaging-proof.ts
//
// Cases: wp-docs-write, wp-docs-check-ok, wp-docs-drift, wp-docs-lint-fail, wp-package-one,
// wp-package-all, wp-release-package, wp-sync-manifests, wp-driver-refusals, wp-driver-rehearsal,
// wp-no-cr. Each runs an entry from a non-POSIX interpreter on Windows (PowerShell, `cmd.exe`) and
// asserts observable outcomes. The elapsed time of each case is printed, never asserted (#1509).
// Exit 0 on success; on any mismatch a message naming every failure with its command, stdout and
// stderr, and exit 1.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { defaultIsFile } from "../../lib/worktree-claim/launch-windows.ts";
import { runPackagingCases } from "./windows-packaging-cases.ts";
import { assertNoBash, attempt } from "./windows-packaging-driver.ts";
import type { Proof } from "./windows-packaging-driver.ts";
import { runDriverCases } from "./windows-packaging-release.ts";
import { resolveInterpreters } from "./windows-proof-support.ts";

/**
 * `wp-no-cr`: no carriage return in a file an entry WROTE. The scan covers the landing zones only
 * (the index, the rewritten manifests, the generated manifest inside each archive): the repository
 * checkout itself may carry CRLF through `core.autocrlf`, and the `AppData` PowerShell keeps is
 * never an entry's output.
 */
function noCarriageReturn(proof: Proof): void {
  assert.ok(proof.landed.length >= 7, `only ${proof.landed.length} written files were recorded`);
  for (const { label, bytes } of proof.landed)
    assert.ok(!bytes.includes(13), `${label} holds a carriage return`);
}

function main(): void {
  console.log(`windows-packaging-proof: platform ${process.platform}, node ${process.version}`);
  const failures: string[] = [];
  const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "windows-packaging-")));
  try {
    const interpreters = resolveInterpreters({
      platform: process.platform,
      env: process.env,
      isFile: defaultIsFile,
    });
    console.log(`windows-packaging-proof: ${interpreters.notes.join("; ")}`);
    const proof: Proof = { interpreters, failures, landed: [], current: "setup" };
    const bins = runPackagingCases(proof, tmp);
    runDriverCases(proof, tmp);
    attempt(proof, "wp-no-cr", () => {
      noCarriageReturn(proof);
      assertNoBash(bins);
    });
  } catch (error) {
    failures.push(`setup: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  if (failures.length === 0) return void console.log("windows-packaging-proof: OK");
  const list = failures.map((f, i) => `${i + 1}. ${f}`).join("\n");
  console.error(`windows-packaging-proof: FAILED: ${failures.length} failure(s)\n${list}`);
  process.exitCode = 1;
}

if (import.meta.main) main();

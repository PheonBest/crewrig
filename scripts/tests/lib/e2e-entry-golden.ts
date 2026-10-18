// e2e-entry-golden.ts — literal-tuple guard for one end-to-end TypeScript ENTRY (issue #1693).
//
// The expected tuples (exit status, stdout, stderr, files written, Docker stand-in calls) live in
// `scripts/tests/fixtures/e2e-oracle/entries/<group>.json.golden`. They were recorded from the REAL
// shell scripts at commit 39d3bceb (the last commit where `e2e-capture-versions.sh` and
// `publish-probe-verdict.sh` were shell, before the J3 shims): Ubuntu 24.04, bash 5.2.21, jq 1.7,
// Node 24, `LC_ALL=C`, with the former shell-versus-TypeScript differential tests active (all passed).
// Nothing here needs a shell file; a case that still differs from its recording is a regression.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { runEntry, type EntryCase, type EntryTuple } from "./e2e-entry-diff.ts";

type Recorded = Omit<EntryTuple, "id">;

const DIR = path.resolve(import.meta.dirname, "..", "fixtures", "e2e-oracle", "entries");

/** Skip reason: the sandbox runner spawns POSIX launchers, so Windows has no leg to run. */
export const ENTRY_SKIP = process.platform === "win32" ? "POSIX-only entry sandbox" : false;

export function loadGolden(group: string): Record<string, Recorded> {
  const file = path.join(DIR, `${group}.json.golden`);
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, Recorded>;
}

/** Run the TypeScript entry for `c` and require exactly the recorded tuple for `c.id`. */
export function assertRecorded(c: EntryCase, golden: Record<string, Recorded>): void {
  const want = golden[c.id];
  assert.ok(want !== undefined, `no recorded tuple for ${c.id}`);
  const got = runEntry(c, "entry");
  assert.ok(got !== null, `no TypeScript entry for ${c.file}`);
  const { id: _id, ...rest } = got;
  assert.deepEqual(rest, want);
}

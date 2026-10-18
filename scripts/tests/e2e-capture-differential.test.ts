// e2e-capture-differential.test.ts — `tests/e2e/lib/test-gemini-headless.ts` against tuples recorded from
// the real shell script (spec 0261 R10; issue #1344 slice 6). The shell script was recorded in two
// Linux images (Ubuntu 24.04, bash 5.2.21, jq 1.7, LC_ALL=C) with identical results before it was
// deleted; the recording is `fixtures/e2e-oracle/entries/gemini.json.golden`. The macOS-only
// `mktemp` parent of the work directory is normalised to `<WORK>` on both sides.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runEntry } from "./lib/e2e-entry-diff.ts";
import { ENTRY_SKIP, loadGolden } from "./lib/e2e-entry-golden.ts";
import { gemini, workPath } from "./lib/e2e-gemini-cases.ts";

const golden = loadGolden("gemini");

describe(
  "gemini headless smoke entry against the recorded shell tuples",
  { skip: ENTRY_SKIP },
  () => {
    for (const c of gemini) {
      it(c.id, () => {
        const want = golden[c.id];
        assert.ok(want !== undefined, `no recorded tuple for ${c.id}`);
        const got = runEntry(c, "entry");
        assert.ok(got !== null, `no TypeScript entry for ${c.file}`);
        const { id: _id, ...rest } = workPath(got);
        assert.deepEqual(rest, want);
      });
    }
  },
);

// packaging-release-differential.test.ts — the entry-level proof against goldens (spec 0257 R24,
// R25). Each case runs through the ENTRIES as black boxes, a fresh sandbox per leg: the shell leg
// `LC_ALL=C bash scripts/<x>.sh` and the TypeScript leg `node scripts/<x>.ts`. The TypeScript leg
// is compared to the stored goldens, which were generated from the original shell scripts before
// the switch. Since the switch the `.sh` leg is a test of the shim: it forwards the entry's output
// unchanged, so it must show no difference and match the same goldens.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { CASES } from "./lib/packaging-release-differential.ts";
import { findDifferences, tagOf } from "./lib/packaging-release-deviations.ts";
import { compareGolden, goldenFiles, pinTs, readGolden } from "./lib/packaging-release-golden.ts";
import { HAS_SHELL_TOOLS, observe } from "./lib/packaging-release-observe.ts";

const skipShell = HAS_SHELL_TOOLS
  ? false
  : "skipped: the shell leg needs bash, jq and tar on a POSIX host";

describe("packaging and release entries: legs and goldens", () => {
  for (const testCase of CASES) {
    test(testCase.name, (t) => {
      const ts = observe("ts", testCase);
      const stored = readGolden(testCase.name);
      assert.notEqual(stored.size, 0, `${testCase.name}: no golden stored`);
      assert.deepEqual(
        compareGolden(goldenFiles(ts), stored),
        [],
        `${testCase.name}: TypeScript leg against the golden`,
      );

      if (testCase.oracle === false) return;
      if (skipShell !== false) return t.skip(skipShell);
      const shell = observe("shell", testCase);
      const diffs = findDifferences(shell, ts);
      const untagged = diffs.filter((d) => tagOf(d) === undefined);
      assert.deepEqual(
        untagged.map(
          (d) =>
            `${d.field}\n  shell: ${JSON.stringify(d.shell)}\n  ts:    ${JSON.stringify(d.ts)}`,
        ),
        [],
        `${testCase.name}: untagged difference between the shell and the TypeScript leg`,
      );
      const tags = [...new Set(diffs.map((d) => tagOf(d)))].join(" ");
      if (tags !== "") t.diagnostic(`deviations hit: ${tags}`);
      assert.deepEqual(
        compareGolden(goldenFiles(pinTs(shell, ts, diffs)), stored),
        [],
        `${testCase.name}: shell leg against the golden`,
      );
    });
  }
});

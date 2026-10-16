// sync-from-upstream-dirty-report.test.ts — the strict dirty-guard report of
// scripts/sync-from-upstream.ts (spec 0260; replaces cases kk, ll, mm, nn, oo of
// test-sync-from-upstream.sh). Assertions are WHOLE-LINE: a report line is two spaces followed by
// the path, because a substring check on a directory name passes against the pre-0129 defect.

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import {
  createSyncRoot,
  dirtyReport,
  makeAdopter,
  makeUpstream,
  runSync,
  why,
  writeFile,
  type SyncRoot,
} from "./lib/sync-fixture.ts";

let sr: SyncRoot;
before(() => {
  sr = createSyncRoot("crewrig-sync-dirty-");
});
after(() => sr.dispose());

interface Row {
  readonly label: string;
  readonly manifest: string[];
  readonly files: Record<string, string>;
  readonly edits: Record<string, string>;
  readonly present: string[];
  readonly absent: string[];
}

const rows: Row[] = [
  {
    label: "kk a directory entry reports the modified member, not the directory",
    manifest: ["tools"],
    files: { "tools/alpha.sh": "upstream alpha", "tools/beta.sh": "upstream beta" },
    edits: { "tools/alpha.sh": "locally customised alpha" },
    present: ["tools/alpha.sh"],
    absent: ["tools"],
  },
  {
    label: "ll every modified member is reported, not just the first",
    manifest: ["tools"],
    files: {
      "tools/alpha.sh": "upstream alpha",
      "tools/beta.sh": "upstream beta",
      "tools/nested/gamma.sh": "upstream gamma",
    },
    edits: {
      "tools/alpha.sh": "locally customised alpha",
      "tools/beta.sh": "locally customised beta",
      "tools/nested/gamma.sh": "locally customised gamma",
    },
    present: ["tools/alpha.sh", "tools/beta.sh", "tools/nested/gamma.sh"],
    absent: ["tools"],
  },
  {
    label: "mm a file governed by two strict entries is reported exactly once",
    manifest: ["papers", "papers/index.json"],
    files: { "papers/index.json": '{"upstream": true}', "papers/other.md": "upstream other" },
    edits: { "papers/index.json": '{"locally": "customised"}' },
    present: ["papers/index.json"],
    absent: ["papers"],
  },
  {
    label: "nn a space-bearing member does not mask a separate modified file",
    manifest: ["container", "b"],
    files: { "container/name b": "upstream spaced", b: "upstream b" },
    edits: { "container/name b": "locally customised spaced", b: "locally customised b" },
    present: ["container/name b", "b"],
    absent: ["container"],
  },
];

function dirtyAdopter(row: Pick<Row, "manifest" | "files" | "edits">): string {
  const adopter = makeAdopter(sr, {
    upstream: makeUpstream(sr, [row.files]),
    manifest: row.manifest,
    files: row.files,
  });
  for (const [rel, content] of Object.entries(row.edits)) writeFile(adopter, rel, content);
  return adopter;
}

describe("dirty report", () => {
  for (const row of rows) {
    test(row.label, () => {
      const out = runSync(sr, dirtyAdopter(row));
      assert.equal(out.status, 1, why(out));
      const lines = dirtyReport(out.stderr);
      for (const p of row.present) {
        const count = lines.filter((line) => line === `  ${p}`).length;
        assert.equal(
          count,
          1,
          `expected the line '  ${p}' exactly once, saw ${count}\n${why(out)}`,
        );
      }
      for (const p of row.absent) {
        assert.ok(!lines.includes(`  ${p}`), `stderr names '${p}' as its own line\n${why(out)}`);
      }
    });
  }

  test("oo the refusal states the targeted restoration and warns against the directory", () => {
    const out = runSync(
      sr,
      dirtyAdopter({
        manifest: ["tools"],
        files: { "tools/alpha.sh": "upstream alpha" },
        edits: { "tools/alpha.sh": "locally customised alpha" },
      }),
    );
    assert.equal(out.status, 1, why(out));
    assert.ok(out.stderr.includes("Never restore the containing directory"), why(out));
    assert.ok(out.stderr.includes("Restore ONLY the files listed above"), why(out));
  });
});

// check-extension-hook-map.test.ts — edge cases the Bash suite does not cover (spec 0259):
// a missing doc (exit 2 on stderr), a doc row for an unknown event, and a table cell naming
// a counterpart where the translator has none. Black-box: a sandbox copy of scripts/ and the
// doc is mutated, never the repository tree.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const roots: string[] = [];

after(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

function sandbox(mutateDoc?: (text: string) => string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hook-map-"));
  roots.push(root);
  fs.cpSync(path.join(REPO, "scripts"), path.join(root, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(root, "docs"));
  const doc = fs.readFileSync(path.join(REPO, "docs", "extension-hook-events.md"), "utf8");
  fs.writeFileSync(
    path.join(root, "docs", "extension-hook-events.md"),
    mutateDoc ? mutateDoc(doc) : doc,
  );
  return root;
}

function run(root: string): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(
    process.execPath,
    [path.join(root, "scripts", "check-extension-hook-map.ts")],
    { cwd: root, encoding: "utf8" },
  );
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe("check-extension-hook-map edge cases", () => {
  test("baseline agrees", () => {
    const r = run(sandbox());
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^OK: docs\/extension-hook-events\.md agrees/);
  });

  test("a missing doc exits 2 with the error on stderr only", () => {
    const root = sandbox();
    fs.rmSync(path.join(root, "docs", "extension-hook-events.md"));
    const r = run(root);
    assert.equal(r.status, 2);
    assert.equal(r.stdout, "");
    assert.equal(
      r.stderr,
      `Error: ${path.join(fs.realpathSync(root), "docs", "extension-hook-events.md")} not found.\n`,
    );
  });

  test("a doc row for an unknown event is a finding", () => {
    const root = sandbox((t) =>
      t.replace(/^(\| `UserPromptSubmit` \|.*)$/m, "$1\n| `Mystery` | `a` | `b` | `c` | `d` |"),
    );
    const r = run(root);
    assert.equal(r.status, 1);
    assert.ok(
      r.stdout.includes(
        "row names event 'Mystery', which the translator does not recognize (scripts/lib/extension-hooks.sh)",
      ),
      r.stdout,
    );
    assert.match(r.stdout, /\nFAILED: 1 disagreement\(s\) between /);
  });

  test("a cell naming a counterpart the translator lacks is a disagreement", () => {
    const root = sandbox((t) => {
      const m = /^\| `UserPromptSubmit` \|.*$/m.exec(t);
      assert.ok(m);
      const cols = m[0].split("|");
      cols[5] = " `Invented` ";
      return t.replace(m[0], cols.join("|"));
    });
    const r = run(root);
    assert.equal(r.status, 1);
    assert.ok(
      r.stdout.includes(
        "  FAIL disagreement (event 'UserPromptSubmit', target 'antigravity') — table says 'Invented', translator's mapping function says ''\n",
      ),
      r.stdout,
    );
  });
});

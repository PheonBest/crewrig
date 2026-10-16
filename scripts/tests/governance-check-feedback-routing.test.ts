// check-feedback-routing.test.ts — black-box edge cases of scripts/check-feedback-routing.ts
// that the Bash suite does not cover (spec 0259): empty, `~`, quoted and `null` values,
// a sequence-valued provenance, a missing or CRLF front matter, a non-mapping document,
// the all-stdout contract and an unreadable file (deviation (d)).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ENTRY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "check-feedback-routing.ts",
);
const tmp = mkdtempSync(path.join(tmpdir(), "feedback-routing-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

let counter = 0;
/** Seed one source per `files` entry (relative path -> text) and run the entry in that tree. */
function runIn(files: Record<string, string>, mode?: number) {
  counter += 1;
  const cwd = path.join(tmp, `t${counter}`);
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(cwd, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
    if (mode !== undefined) chmodSync(file, mode);
  }
  mkdirSync(cwd, { recursive: true });
  const r = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", ENTRY], {
    cwd,
    encoding: "utf8",
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const SRC = "artifacts/core/skills/s/SKILL.md";
const prov = (feedback: string, canonical = "    canonical: c\n"): string =>
  `---\nmetadata:\n  provenance:\n${canonical}${feedback}---\n`;
const skipped = (n: number, checked = 0): string =>
  `\nOK: ${checked} upstream-owned source(s) route feedback to canonical (${n} without a feedback declaration skipped).\n`;

describe("check-feedback-routing edge cases", () => {
  it("skips empty, null-spelled, false and literal null feedback values", () => {
    for (const fb of [
      "    feedback:\n",
      "    feedback: ~\n",
      "    feedback: false\n",
      '    feedback: "null"\n',
    ]) {
      const r = runIn({ [SRC]: prov(fb) });
      assert.deepEqual([r.status, r.stdout, r.stderr], [0, skipped(1), ""], JSON.stringify(fb));
    }
  });

  it("compares quoted tilde and number text as written", () => {
    const r = runIn({ [SRC]: prov('    feedback: "~"\n', '    canonical: "~"\n') });
    assert.equal(r.stdout, `  OK   ${SRC}\n${skipped(0, 1)}`);
    const n = runIn({ [SRC]: prov("    feedback: 1.0\n", "    canonical: 1.0\n") });
    assert.equal(n.status, 0);
  });

  it("reports a missing canonical as an empty string, everything on stdout", () => {
    const r = runIn({ [SRC]: prov("    feedback: d\n", "") });
    assert.equal(r.status, 1);
    assert.equal(r.stderr, "");
    assert.ok(r.stdout.startsWith(`  FAIL ${SRC} — feedback 'd' != canonical ''\n\nFAILED: 1 `));
  });

  it("orders sources by the whole path across roots", () => {
    const text = prov("    feedback: c\n");
    const r = runIn({
      "extensions/core/e/SKILL.md": text,
      "artifacts/library/commands/b.md": text,
      "artifacts/core/skills/s/SKILL.md": text,
      "artifacts/core/skills/s/notes.md": text,
    });
    assert.deepEqual(
      [...r.stdout.matchAll(/  OK   (.*)\n/g)].map((m) => m[1]),
      [
        "artifacts/core/skills/s/SKILL.md",
        "artifacts/library/commands/b.md",
        "extensions/core/e/SKILL.md",
      ],
    );
  });

  it("skips a missing, CRLF or non-mapping front matter and a scalar provenance", () => {
    const docs = [
      "no front matter\n",
      "---\r\nmetadata:\r\n  provenance:\r\n    feedback: d\r\n---\r\n",
      "---\n- a\n---\n",
      "---\nfoo\n---\n",
      "---\nmetadata: x\n---\n",
      "---\nmetadata:\n  provenance: x\n---\n",
      "---\nmetadata: [\n---\n",
    ];
    for (const text of docs) {
      const r = runIn({ [SRC]: text });
      assert.deepEqual([r.status, r.stdout], [0, skipped(1)], JSON.stringify(text));
    }
  });

  it("aborts silently with status 1 when provenance is a sequence", () => {
    const r = runIn({ [SRC]: "---\nmetadata:\n  provenance: [a]\n---\n" });
    assert.deepEqual([r.status, r.stdout, r.stderr], [1, "", ""]);
  });

  it(
    "prints one Error line and exits 1 for an unreadable source",
    { skip: process.platform === "win32" || process.getuid?.() === 0 },
    () => {
      const r = runIn({ [SRC]: prov("    feedback: c\n") }, 0o000);
      assert.equal(r.status, 1);
      assert.equal(r.stdout, "");
      assert.equal(r.stderr, `Error: ${SRC}: Permission denied\n`);
    },
  );

  it("reports a duplicated mapping key as a FAIL line (deviation (e))", () => {
    const r = runIn({
      [SRC]: "---\nmetadata:\n  provenance:\n    feedback: c\n    feedback: d\n---\n",
    });
    assert.equal(r.status, 1);
    assert.equal(r.stderr, "");
    assert.ok(
      r.stdout.startsWith(`  FAIL ${SRC} — duplicated mapping key in front matter\n\nFAILED: 1 `),
    );
  });
});

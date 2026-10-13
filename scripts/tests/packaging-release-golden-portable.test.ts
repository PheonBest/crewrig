// packaging-release-golden-portable.test.ts — the stored goldens of the packaging and release
// proof hold nothing machine-specific (spec 0257 R25): no Node path, temp directory, home
// directory, Windows drive path or leading `#!`, every name ends in `.golden`, and no golden
// directory is empty (anti-vacuity).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { CASES } from "./lib/packaging-release-differential.ts";
import { GOLDEN_ROOT, readGolden } from "./lib/packaging-release-golden.ts";

const FORBIDDEN: readonly [string, (text: string) => boolean][] = [
  ["a Node path", (t) => t.includes(process.execPath)],
  [
    "a temp directory",
    (t) =>
      t.includes(fs.realpathSync.native(os.tmpdir())) ||
      t.includes(os.tmpdir()) ||
      /\/(?:var\/folders|tmp)\//.test(t),
  ],
  ["/Users/", (t) => t.includes("/Users/")],
  ["a Windows path", (t) => t.includes("C:\\") || /\b[A-Za-z]:\\\\/.test(t)],
  ["a leading #!", (t) => t.startsWith("#!")],
];

test("every case has a non-empty golden directory", () => {
  for (const testCase of CASES) {
    const files = readGolden(testCase.name);
    for (const required of ["status.golden", "stdout.golden", "stderr.golden"]) {
      assert.ok(files.has(required), `${testCase.name}: ${required} is missing`);
    }
  }
  const stored = fs.readdirSync(GOLDEN_ROOT).sort();
  assert.deepEqual(
    stored,
    CASES.map((c) => c.name).sort(),
    "a golden directory without a case, or a case without one",
  );
});

test("no golden holds a machine-specific value", () => {
  for (const testCase of CASES) {
    for (const [rel, text] of readGolden(testCase.name)) {
      assert.ok(rel.endsWith(".golden"), `${testCase.name}/${rel}: not a .golden name`);
      for (const [what, found] of FORBIDDEN) {
        assert.ok(!found(text), `${testCase.name}/${rel}: holds ${what}`);
      }
    }
  }
  assert.ok(path.isAbsolute(GOLDEN_ROOT));
});

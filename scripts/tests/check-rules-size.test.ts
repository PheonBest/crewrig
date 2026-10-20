// check-rules-size.test.ts — black-box test of scripts/check-rules-size.ts (spec 0270 R10-R11).
// Fixtures live in mkdtemp directories only.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { BUDGET } from "../lib/governance/rules-size.ts";

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = path.join(SCRIPTS, "check-rules-size.ts");
const tmp = mkdtempSync(path.join(tmpdir(), "rules-size-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

const run = (args: string[]) => {
  const r = spawnSync(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", ENTRY, ...args],
    { cwd: tmp, encoding: "utf8", env: { ...process.env } },
  );
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};

let n = 0;
function rulesDir(files: Record<string, number>): string {
  const dir = path.join(tmp, `d${n++}`);
  mkdirSync(dir);
  for (const [name, bytes] of Object.entries(files)) writeFileSync(path.join(dir, name), "a".repeat(bytes));
  return dir;
}

describe("check-rules-size", () => {
  it("pins the budget constant", () => {
    assert.equal(BUDGET, 27800);
  });

  it("passes under the budget and prints total and budget", () => {
    const r = run([rulesDir({ "a.md": 100, "b.md": 200 })]);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "OK: core rules total 300 bytes across 2 file(s) (budget: 27800 bytes)\n");
    assert.equal(r.stderr, "");
  });

  for (const [bytes, status] of [
    [27799, 0],
    [27800, 1],
    [27801, 1],
  ] as const) {
    it(`boundary ${bytes} bytes exits ${status}`, () => {
      const r = run([rulesDir({ "a.md": bytes - 1000, "b.md": 1000 })]);
      assert.equal(r.status, status);
    });
  }

  it("fails over the budget with the ERROR lines", () => {
    const r = run([rulesDir({ "a.md": 30000 })]);
    assert.equal(r.status, 1);
    assert.equal(r.stdout, "");
    assert.equal(
      r.stderr,
      "ERROR: core rules total 30000 bytes — meets or exceeds the 27800-byte budget.\n" +
        "Extract more content to docs/ to bring artifacts/core/rules/*.md below the budget.\n",
    );
  });

  it("counts bytes, not characters", () => {
    // 13900 x "é" = 13900 characters, 27800 bytes: fails only on a byte count.
    const dir = path.join(tmp, `d${n++}`);
    mkdirSync(dir);
    writeFileSync(path.join(dir, "a.md"), "é".repeat(13900));
    assert.equal(run([dir]).status, 1);
  });

  it("does not count files that are not .md or sit outside the directory", () => {
    const dir = rulesDir({ "a.md": 100, "notes.txt": 50000 });
    writeFileSync(path.join(tmp, "outside.md"), "a".repeat(50000));
    const r = run([dir]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /total 100 bytes across 1 file/);
  });

  it("fails closed on a directory without any .md file", () => {
    const r = run([rulesDir({ "notes.txt": 10 })]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no \.md rules file found/);
  });

  it("fails closed on a missing directory", () => {
    const r = run(["absent"]);
    assert.equal(r.status, 1);
    assert.equal(r.stdout, "");
    assert.equal(r.stderr, "Error: absent: No such directory\n");
  });

  it("fails closed on an unreadable directory", { skip: process.platform === "win32" || process.getuid?.() === 0 }, () => {
    const dir = rulesDir({ "a.md": 10 });
    chmodSync(dir, 0o000);
    try {
      const r = run([dir]);
      assert.equal(r.status, 1);
      assert.match(r.stderr, /Permission denied/);
    } finally {
      chmodSync(dir, 0o755);
    }
  });
});

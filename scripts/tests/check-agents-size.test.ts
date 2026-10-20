// check-agents-size.test.ts — black-box test of scripts/check-agents-size.ts.
// Each case asserts the entry against FROZEN expectations recorded on Linux from the
// original shell script under LC_ALL=C (fixtures/governance-oracle/check-agents-size.json.golden),
// except the missing-file case (deviation (d)). The golden was regenerated for the spec 0270 threshold
// (19100 B, was 22000 B): the shell script is gone, so the recording follows the TS implementation, and
// the explicit literal assertions in each case keep the byte-exact value pinned independently of it.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = path.join(SCRIPTS, "check-agents-size.ts");
const GOLDEN = path.join(
  SCRIPTS,
  "tests",
  "fixtures",
  "governance-oracle",
  "check-agents-size.json.golden",
);
const tmp = mkdtempSync(path.join(tmpdir(), "agents-size-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

const ORACLE: Record<string, Run> = JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, Run>;

const ts = (args: string[]): Run => {
  const r = spawnSync(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", ENTRY, ...args],
    { cwd: tmp, encoding: "utf8", env: { ...process.env } },
  );
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};

/** Byte-for-byte comparison with the frozen shell recording of `key`. */
function sameAsShell(key: string, actual: Run): void {
  assert.deepEqual(actual, ORACLE[key]);
}

function sized(name: string, bytes: number, fill = "a"): string {
  writeFileSync(path.join(tmp, name), fill.repeat(bytes));
  return name;
}

describe("check-agents-size", () => {
  it("passes under the threshold", () => {
    const f = sized("pass.md", 100);
    const r = ts([f]);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "OK: AGENTS.md is 100 bytes (threshold: 19100 bytes)\n");
    assert.equal(r.stderr, "");
    sameAsShell("pass", r);
  });

  it("fails over the threshold", () => {
    const f = sized("fail.md", 30000);
    const r = ts([f]);
    assert.equal(r.status, 1);
    assert.equal(r.stdout, "");
    assert.equal(
      r.stderr,
      "ERROR: AGENTS.md is 30000 bytes — meets or exceeds the 19100-byte threshold.\n" +
        "Extract more content to docs/ to bring AGENTS.md below 19 100 bytes.\n",
    );
    sameAsShell("fail", r);
  });

  for (const [bytes, status] of [
    [19099, 0],
    [19100, 1],
    [19101, 1],
  ] as const) {
    it(`boundary ${bytes} bytes exits ${status}`, () => {
      const f = sized(`b${bytes}.md`, bytes);
      const r = ts([f]);
      assert.equal(r.status, status);
      sameAsShell(`b${bytes}`, r);
    });
  }

  it("counts bytes, not characters", () => {
    // 9550 x "é" = 9550 characters, 19100 bytes: fails only on a byte count.
    const f = sized("multi.md", 9550, "é");
    const r = ts([f]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /is 19100 bytes/);
    sameAsShell("multi", r);
  });

  it("defaults to AGENTS.md in the current directory", () => {
    sized("AGENTS.md", 42);
    const r = ts([]);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "OK: AGENTS.md is 42 bytes (threshold: 19100 bytes)\n");
    sameAsShell("default", r);
  });

  it("reports a missing file on one stderr line (deviation d, no shell comparison)", () => {
    const r = ts(["absent.md"]);
    assert.equal(r.status, 1);
    assert.equal(r.stdout, "");
    assert.equal(r.stderr, "Error: absent.md: No such file or directory\n");
  });
});

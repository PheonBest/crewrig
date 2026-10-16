// check-agents-size.test.ts — black-box test of scripts/check-agents-size.ts.
// The shell script has no Bash test, so this suite is the oracle (spec 0259 R14):
// each case also runs the shell script under LC_ALL=C and compares stdout,
// stderr and exit code, except the missing-file case (deviation (d)).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = path.join(SCRIPTS, "check-agents-size.ts");
const SHELL = path.join(SCRIPTS, "check-agents-size.sh");
const WIN = process.platform === "win32";
const bashOk = !WIN && spawnSync("bash", ["--version"]).status === 0;
if (!WIN && !bashOk && process.env.CI)
  throw new Error("bash is required in CI for the oracle comparison");

const tmp = mkdtempSync(path.join(tmpdir(), "agents-size-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv = {}): Run {
  const r = spawnSync(cmd, args, {
    cwd: tmp,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const ts = (args: string[]): Run =>
  run(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", ENTRY, ...args]);

/** Compare to the shell oracle when bash is available. */
function sameAsShell(args: string[], actual: Run): void {
  if (!bashOk) return;
  const sh = run("bash", [SHELL, ...args], { LC_ALL: "C" });
  // BSD wc (macOS) left-pads the count with spaces; GNU wc does not. Not a TS divergence.
  sh.stdout = sh.stdout.replace(/(AGENTS\.md is) +(\d)/, "$1 $2");
  sh.stderr = sh.stderr.replace(/(AGENTS\.md is) +(\d)/, "$1 $2");
  assert.deepEqual(actual, sh);
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
    assert.equal(r.stdout, "OK: AGENTS.md is 100 bytes (threshold: 22000 bytes)\n");
    assert.equal(r.stderr, "");
    sameAsShell([f], r);
  });

  it("fails over the threshold", () => {
    const f = sized("fail.md", 30000);
    const r = ts([f]);
    assert.equal(r.status, 1);
    assert.equal(r.stdout, "");
    assert.equal(
      r.stderr,
      "ERROR: AGENTS.md is 30000 bytes — meets or exceeds the 22000-byte threshold.\n" +
        "Extract more content to docs/ to bring AGENTS.md below 22 000 bytes.\n",
    );
    sameAsShell([f], r);
  });

  for (const [bytes, status] of [
    [21999, 0],
    [22000, 1],
    [22001, 1],
  ] as const) {
    it(`boundary ${bytes} bytes exits ${status}`, () => {
      const f = sized(`b${bytes}.md`, bytes);
      const r = ts([f]);
      assert.equal(r.status, status);
      sameAsShell([f], r);
    });
  }

  it("counts bytes, not characters", () => {
    // 11000 x "é" = 11000 characters, 22000 bytes: fails only on a byte count.
    const f = sized("multi.md", 11000, "é");
    const r = ts([f]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /is 22000 bytes/);
    sameAsShell([f], r);
  });

  it("defaults to AGENTS.md in the current directory", () => {
    sized("AGENTS.md", 42);
    const r = ts([]);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "OK: AGENTS.md is 42 bytes (threshold: 22000 bytes)\n");
    sameAsShell([], r);
  });

  it("reports a missing file on one stderr line (deviation d, no shell comparison)", () => {
    const r = ts(["absent.md"]);
    assert.equal(r.status, 1);
    assert.equal(r.stdout, "");
    assert.equal(r.stderr, "Error: absent.md: No such file or directory\n");
  });
});

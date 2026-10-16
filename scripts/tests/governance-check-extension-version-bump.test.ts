// check-extension-version-bump.test.ts — black-box test of
// scripts/check-extension-version-bump.ts for the edge cases the Bash suite does not
// cover (spec 0259): duplicate field, no body line, empty or absent carrier on the
// base. Each case also runs the shell script under LC_ALL=C and compares stdout,
// stderr and exit code when bash is available.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { carrierField, firstBodyLine } from "../lib/governance/carrier.ts";

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = path.join(SCRIPTS, "check-extension-version-bump.ts");
const SHELL = path.join(SCRIPTS, "check-extension-version-bump.sh");
const bashOk = process.platform !== "win32" && spawnSync("bash", ["--version"]).status === 0;
if (process.platform !== "win32" && !bashOk && process.env.CI)
  throw new Error("bash is required in CI for the oracle comparison");

const tmp = mkdtempSync(path.join(tmpdir(), "ext-bump-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

const SKILL = "extensions/core/skills/example/SKILL.md";
const CARRIER_TAIL = ' canonical="c" feedback="f" -->';

function git(cwd: string, ...args: string[]): void {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
}

/** A repo with a base commit holding `base` and a head commit holding `head`. */
function repo(name: string, base: string, head: string): string {
  const dir = path.join(tmp, name);
  mkdirSync(path.join(dir, path.dirname(SKILL)), { recursive: true });
  git(dir, "init", "-q");
  for (const [k, v] of [
    ["user.email", "t@example.com"],
    ["user.name", "T"],
    ["commit.gpgsign", "false"],
  ] as const)
    git(dir, "config", k, v);
  for (const content of [base, head]) {
    writeFileSync(path.join(dir, SKILL), content);
    git(dir, "add", SKILL);
    git(dir, "commit", "-q", "-m", "c");
  }
  return dir;
}

const doc = (body: string): string => `---\nname: example\n---\n${body}`;
const carrier = (fields: string): string => `<!-- crewrig-provenance: ${fields}${CARRIER_TAIL}\n`;

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

function run(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): Run {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", env: { ...process.env, ...env } });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function check(dir: string, expectedStatus: number, stdoutPart: string): void {
  const actual = run(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", ENTRY, "HEAD~1"],
    dir,
  );
  assert.equal(actual.status, expectedStatus, actual.stdout + actual.stderr);
  assert.ok(actual.stdout.includes(stdoutPart), actual.stdout);
  if (bashOk) assert.deepEqual(actual, run("bash", [SHELL, "HEAD~1"], dir, { LC_ALL: "C" }));
}

describe("carrier parser", () => {
  it("firstBodyLine skips blank lines and stops at a third fence", () => {
    assert.equal(firstBodyLine("---\na: 1\n---\n\n  \t\nX\nY\n"), "X");
    assert.equal(firstBodyLine("---\na: 1\n---\n---\nX\n"), "");
    assert.equal(firstBodyLine("---\na: 1\n---\n"), "");
    assert.equal(firstBodyLine("no frontmatter\n"), "");
  });
  it("carrierField is greedy so the last duplicate wins", () => {
    assert.equal(carrierField('<!-- x version="1" version="2" -->', "version"), "2");
    assert.equal(carrierField('<!-- x version="" -->', "version"), "");
    assert.equal(carrierField("<!-- x -->", "version"), "");
  });
});

describe("extension version bump edge cases", () => {
  it("duplicate version field: last one counts on both sides", () => {
    const base = doc(carrier('version="1.0.0" version="1.0.1"'));
    const head = doc(`${carrier('version="9.9.9" version="1.0.1"')}x\n`);
    check(repo("dup", base, head), 1, "version not bumped (still '1.0.1')");
  });
  it("no body line on the working tree: hard failure", () => {
    const base = doc(carrier('version="1.0.0"'));
    check(repo("nobody", base, "---\nname: example\n---\n"), 1, "no (or empty) crewrig-provenance");
  });
  it("empty version on base: hard failure, not exempt", () => {
    const base = doc(carrier('version=""'));
    const head = doc(carrier('version="1.0.0"'));
    check(repo("emptybase", base, head), 1, "base carrier present but its version is empty");
  });
  it("carrier absent on base: exempt", () => {
    const head = doc(carrier('version="1.0.0"'));
    check(repo("nocarrier", doc("Body.\n"), head), 0, "base had no provenance carrier");
  });
});

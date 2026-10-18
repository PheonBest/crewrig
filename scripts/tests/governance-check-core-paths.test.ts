// check-core-paths.test.ts — black-box edge cases of scripts/check-core-paths.ts that
// the Bash suite does not cover (spec 0259 req 12): a failing builder, an empty
// output list, a manifest path with a trailing slash, and a governed directory that
// exists only in the working tree.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ENTRY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "check-core-paths.ts",
);
const tmp = mkdtempSync(path.join(tmpdir(), "core-paths-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

const GIT_ENV = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};

function git(cwd: string, ...args: string[]): void {
  const r = spawnSync("git", args, { cwd, env: { ...process.env, ...GIT_ENV } });
  assert.equal(r.status, 0, String(r.stderr));
}

let counter = 0;
/** A committed fixture repo; `untracked` files are written after the commit. */
function fixture(
  builder: string,
  manifest: string,
  untracked: Record<string, string> = {},
): string {
  const repo = path.join(tmp, `repo${counter++}`);
  mkdirSync(path.join(repo, ".crewrig"), { recursive: true });
  mkdirSync(path.join(repo, "scripts"));
  mkdirSync(path.join(repo, "tracked"));
  writeFileSync(path.join(repo, "tracked", "f.txt"), "x\n");
  writeFileSync(path.join(repo, "scripts", "build-components.ts"), builder);
  writeFileSync(path.join(repo, ".crewrig", "core-paths.txt"), manifest);
  git(repo, "init", "-q");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "init");
  for (const [rel, body] of Object.entries(untracked)) {
    mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    writeFileSync(path.join(repo, rel), body);
  }
  return repo;
}

function run(repo: string) {
  const r = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", ENTRY], {
    encoding: "utf8",
    env: { ...process.env, CREWRIG_REPO_DIR: repo },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const LIST = (...dirs: string[]): string =>
  `if (process.argv[2] === "--list-output-dirs") {\n${dirs
    .map((d) => `  console.log(${JSON.stringify(d)});\n`)
    .join("")}}\n`;

describe("check-core-paths edge cases", () => {
  it("exits 2 naming the query when the builder exits non-zero", () => {
    const repo = fixture(
      'if (process.argv[2] === "--list-output-dirs") { console.error("boom"); process.exit(3); }\n',
      "tracked\tstrict\n",
    );
    const r = run(repo);
    assert.equal(r.status, 2);
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /^Error: failed to query built-output directories from build script: /);
    assert.doesNotMatch(r.stderr, /boom/);
  });

  it("accepts an empty output list and reports 0 governed directories", () => {
    const r = run(fixture("if (process.argv[2] === '--list-output-dirs') {}\n", "tracked\n"));
    assert.equal(r.status, 0);
    assert.match(r.stdout, /OK: all 0 built-output directories derived from /);
  });

  it("does not govern a directory through a trailing-slash manifest path", () => {
    const r = run(fixture(LIST(".claude/skills"), "tracked\n.claude/\tregenerable\n"));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /FAIL \.claude\/ \(regenerable\) — does not resolve/);
  });

  it("checks the trailing-slash path against HEAD and governs nothing below it", () => {
    const r = run(fixture(LIST("tracked/sub"), "tracked/\tstrict\n"));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /FAILED: 1 of 1 built-output director\(y\/ies\)/);
    assert.match(r.stderr, / {2}- tracked\/sub\n/);
  });

  it("fails a governed directory present only in the working tree", () => {
    const r = run(fixture(LIST(), "tracked\tstrict\nlocal\tstrict\n", { "local/a.txt": "y\n" }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /FAIL local \(strict\) — does not resolve to tracked content at HEAD/);
    assert.equal(r.stdout, "");
  });
});

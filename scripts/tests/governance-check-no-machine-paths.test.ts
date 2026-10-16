// check-no-machine-paths.test.ts — edge cases the Bash suite does not cover (spec 0259):
// CRLF content, a NUL-containing binary file, Windows drive-letter forms, a self-exclusion.
// Black-box: the entry runs against throwaway `git init` repositories via CREWRIG_REPO_DIR.
// Unsupported (documented in machine-paths.ts): a tracked path that contains a colon.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHECK = path.join(REPO, "scripts", "check-no-machine-paths.ts");
const OK_LINE = "OK: no machine-specific home-directory paths in tracked files.\n";
const roots: string[] = [];

after(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

/** Create a committed fixture repository from `files` (name to bytes). */
function fixture(files: Record<string, Buffer | string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nmp-"));
  roots.push(dir);
  const git = (...a: string[]) => spawnSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  git("init", "-q");
  for (const [name, data] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), data);
    git("add", name);
  }
  return dir;
}

function run(dir: string) {
  const res = spawnSync(process.execPath, [CHECK], {
    env: { ...process.env, CREWRIG_REPO_DIR: dir, LC_ALL: "C" },
    encoding: "utf8",
  });
  return { code: res.status, out: res.stdout, err: res.stderr };
}

describe("check-no-machine-paths edge cases", () => {
  test("CRLF content: a slash-less owner before a CR is not a token, a following slash is", () => {
    const r = run(fixture({ "a.txt": "x=/Users/bob\r\ny=/Users/bob/z\r\n" }));
    assert.equal(r.code, 1);
    assert.match(r.err, /^a\.txt:2: \/Users\/bob\/$/m);
    assert.doesNotMatch(r.err, /^a\.txt:1:/m);
  });

  test("NUL-containing binary file: git reports a match without content, no token", () => {
    const r = run(fixture({ "b.bin": Buffer.from("\0/Users/bob/x\n", "latin1") }));
    assert.equal(r.code, 0);
    assert.equal(r.out, OK_LINE);
  });

  test("Windows drive-letter forms", () => {
    const flagged = run(
      fixture({ "w.txt": "C:/Users/bob/x\nD:/Users/ana/y\nhost:/Users/ana/z\nC:/home/ana/q\n" }),
    );
    assert.equal(flagged.code, 1);
    assert.match(flagged.err, /^w\.txt:1: C:\/Users\/bob\/$/m);
    assert.doesNotMatch(flagged.err, /^w\.txt:2:/m);
    assert.match(flagged.err, /^w\.txt:3: t:\/Users\/ana\/$/m);
    assert.match(flagged.err, /^w\.txt:4: C:\/home\/ana\/$/m);
    assert.match(flagged.err, /FAILED: 3 machine-specific/);
  });

  test("backslash Windows paths are not a token", () => {
    const r = run(fixture({ "p.txt": "C:\\Users\\bob\\x\n" }));
    assert.equal(r.code, 0);
  });

  test("the TypeScript twin's own files are excluded", () => {
    const r = run(
      fixture({
        "scripts/check-no-machine-paths.ts": "/Users/bob/\n",
        "scripts/tests/governance-check-no-machine-paths.test.ts": "/home/bob/\n",
        "scripts/tests/windows-governance-repo-scans.test.ts": "/home/bob/\n",
      }),
    );
    assert.equal(r.code, 0);
  });
});

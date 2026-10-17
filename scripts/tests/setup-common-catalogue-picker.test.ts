// setup-common-catalogue-picker.test.ts — the shell function pick_catalogue_entry() of
// scripts/lib/common.sh (spec 0096, issue #603), driven through bashLibs with a stub `fzf` on PATH.
// Ported from scripts/tests/test-setup-catalogue-picker.sh groups G1-G3 (spec 0263, row A); the
// declaration parity (G4) and the four-CLI smoke (G5) are pinned by setup-retarget-catalogue-picker
// and setup-retarget-behaviour-a. POSIX-only (Bash library, shell-script stub): skipped on win32.
// Retires with scripts/lib/common.sh (row J4).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { bashLibs } from "./lib/bash-libs.ts";
import { cleanEnv, realTmp, SKIP_POSIX } from "./lib/worktree-fixtures.ts";

const quote = (s: string): string => `'${s.replaceAll("'", "'\\''")}'`;

let root = "";
let stubDir = "";
let sentinel = "";
let capture = "";

/** Write an executable stub `fzf` that records its use in the sentinel file, then runs `body`. */
function stubFzf(body: string): void {
  const file = path.join(stubDir, "fzf");
  fs.writeFileSync(file, `#!/bin/bash\necho called >> "${sentinel}"\n${body}\n`, { mode: 0o755 });
}

/** PATH with every directory holding a real `fzf` removed, the stub directory in front. */
function pathWithStub(): string {
  const dirs = (process.env["PATH"] ?? "")
    .split(path.delimiter)
    .filter((d) => d !== "" && !fs.existsSync(path.join(d, "fzf")));
  return [stubDir, ...dirs].join(path.delimiter);
}

function pick(dir: string, label: string): ReturnType<typeof bashLibs> {
  const env = { ...cleanEnv(), PATH: pathWithStub(), FZF_STDIN_CAPTURE: capture };
  return bashLibs(
    `set -e; pick_catalogue_entry ${quote(dir)} ${quote(label)}; echo "rc=$?" >&2`,
    env,
    ["common.sh"],
  );
}

function oneEntryDir(): string {
  const dir = path.join(root, "one-entry");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "backend.md"), "# fixture\n");
  return dir;
}

describe("common.sh pick_catalogue_entry", { skip: SKIP_POSIX }, () => {
  beforeEach(() => {
    root = realTmp("crewrig-catalogue-");
    stubDir = path.join(root, "stubs");
    fs.mkdirSync(stubDir);
    sentinel = path.join(root, "fzf-called");
    capture = path.join(root, "fzf-stdin.txt");
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("empty catalogue never reaches fzf", () => {
    stubFzf("cat > /dev/null; exit 1");
    const empty = path.join(root, "empty");
    fs.mkdirSync(empty);
    const r = pick(empty, "team");
    assert.match(r.stderr, /rc=0\n$/);
    assert.equal(r.stdout, "");
    assert.ok(!fs.existsSync(sentinel), "fzf was invoked despite zero candidates");
    assert.doesNotMatch(r.stderr, /command not found/i);
    assert.match(r.stderr, /No team catalogue entries found/);
  });

  it("declined pick is neutralised, real candidate only", () => {
    stubFzf('cat > "$FZF_STDIN_CAPTURE"; exit 1');
    const r = pick(oneEntryDir(), "expertise");
    assert.match(r.stderr, /rc=0\n$/);
    assert.equal(r.stdout, "");
    const fed = fs.readFileSync(capture, "utf8");
    assert.doesNotMatch(fed, /^\*$|\*\.md/m);
    assert.equal(fed.trimEnd(), "backend");
    assert.match(r.stderr, /No expertise selected/);
  });

  it("golden pick returns the basename", () => {
    stubFzf("cat > /dev/null; echo backend");
    const r = pick(oneEntryDir(), "expertise");
    assert.match(r.stderr, /rc=0\n$/);
    assert.equal(r.stdout, "backend\n");
  });
});

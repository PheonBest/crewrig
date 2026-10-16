// windows-governance-repo-scans.test.ts — the cross-system proof of the repo-scans checks
// (spec 0259 R26-R28): check-no-machine-paths, check-test-wiring, check-test-strays and
// check-markdown-links run from PowerShell on Windows, from the default shell elsewhere, against
// the real repository and against a failing fixture. Interpreters are resolved from the PARENT PATH
// before the child PATH is narrowed. The `windows-governance-checks` job runs every
// `windows-governance-*.test.ts` file.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { defaultIsFile, resolveOnPath } from "../lib/worktree-claim/launch-windows.ts";
import {
  expectStatus,
  resolveInterpreters,
  spawnEntry,
  WIN,
  why,
} from "./lib/windows-proof-support.ts";
import type { Run } from "./lib/windows-proof-support.ts";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const entryPath = (name: string): string => path.join(repo, "scripts", `${name}.ts`);
const lf = (text: string): string => text.replaceAll("\r\n", "\n");
// A home-directory path literal, assembled at runtime so this file stays clean for the guard.
const homePath = ["", "home", "alice", "notes.txt"].join("/");

/**
 * `git` must stay reachable once spawnEntry narrows the child PATH to node, System32 and the stubs:
 * on Windows its directory (found on the PARENT PATH) is prepended to the stub directory.
 */
function withGitDir(bin: string): string {
  if (!WIN) return bin;
  const git = resolveOnPath("git", {
    platform: process.platform,
    env: process.env,
    isFile: defaultIsFile,
  });
  return git === undefined ? bin : [path.win32.dirname(git), bin].join(path.delimiter);
}

function withBox<T>(body: (root: string, bin: string) => T): T {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "windows-repo-scans-")),
  );
  try {
    const bin = path.join(root, "bin");
    fs.mkdirSync(bin);
    return body(root, bin);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function run(
  name: string,
  label: string,
  args: string[],
  root: string,
  bin: string,
  extra: Record<string, string> = {},
): Run {
  // Resolved from the parent environment, before spawnEntry narrows the child PATH.
  const interpreters = resolveInterpreters({
    platform: process.platform,
    env: process.env,
    isFile: defaultIsFile,
  });
  console.log(`windows-governance-repo-scans: ${label}: ${interpreters.notes.join("; ")}`);
  return spawnEntry({
    entry: label,
    script: entryPath(name),
    args,
    shell: "pwsh",
    env: {
      GIT_CONFIG_NOSYSTEM: "1",
      NODE_OPTIONS: "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      ...extra,
    },
    home: root,
    bin: withGitDir(bin),
    interpreters,
  });
}

function git(cwd: string, args: string[]): void {
  const full = [
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "-c",
    "core.autocrlf=false",
    ...args,
  ];
  const r = spawnSync("git", full, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
  });
  assert.equal(r.status, 0, `git ${args.join(" ")}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
}

/** A temp git repository holding `files` (relative path to content), all tracked and committed. */
function makeRepo(root: string, files: Record<string, string>): string {
  const dir = path.join(root, "fixture");
  fs.mkdirSync(dir);
  git(dir, ["init", "-q"]);
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(dir, ...rel.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "fixture"]);
  return dir;
}

/** Run from `cwd` (the markdown-links check reads the Git top level of its working directory). */
function inDir<T>(cwd: string, body: () => T): T {
  const before = process.cwd();
  process.chdir(cwd);
  try {
    return body();
  } finally {
    process.chdir(before);
  }
}

describe("windows governance repo-scans: check-no-machine-paths", () => {
  it("accepts the real repository", () => {
    withBox((root, bin) => {
      const r = run("check-no-machine-paths", "no-machine-paths real", [], root, bin);
      expectStatus(r, 0);
      assert.match(
        lf(r.out),
        /^OK: no machine-specific home-directory paths in tracked files\.\n$/,
        why(r, "verdict line"),
      );
    });
  });

  it("rejects a tracked home-directory path with the FAILED block", () => {
    withBox((root, bin) => {
      const dir = makeRepo(root, { "notes.txt": `see ${homePath}\n` });
      const r = run("check-no-machine-paths", "no-machine-paths fixture", [], root, bin, {
        CREWRIG_REPO_DIR: dir,
      });
      expectStatus(r, 1);
      assert.match(lf(r.err), /^notes\.txt:1: \/home\/alice\/$/m, why(r, "finding line"));
      assert.match(
        lf(r.err),
        /^FAILED: 1 machine-specific home-directory path\(s\) in tracked files/m,
        why(r, "FAILED block"),
      );
    });
  });
});

describe("windows governance repo-scans: check-test-wiring", () => {
  it("accepts the real repository", () => {
    withBox((root, bin) => {
      const r = run("check-test-wiring", "test-wiring real", [], root, bin);
      expectStatus(r, 0);
      assert.match(lf(r.out), /^OK: all test scripts are wired/, why(r, "verdict line"));
    });
  });

  it("rejects an unwired test script", () => {
    withBox((root, bin) => {
      const dir = path.join(root, "tree");
      fs.mkdirSync(path.join(dir, "scripts", "tests"), { recursive: true });
      fs.writeFileSync(path.join(dir, "scripts", "tests", "test-x.sh"), "#!/usr/bin/env bash\n");
      const r = run("check-test-wiring", "test-wiring fixture", [], root, bin, {
        CREWRIG_REPO_DIR: dir,
      });
      expectStatus(r, 1);
      assert.match(
        lf(r.err),
        /^FAILED: 1 test script\(s\) run in no CI workflow/m,
        why(r, "orphan block"),
      );
      assert.match(r.err, /test-x\.sh/, why(r, "orphan name"));
    });
  });
});

describe("windows governance repo-scans: check-test-strays", () => {
  it("accepts the real repository (SKIP on win32)", () => {
    withBox((root, bin) => {
      const r = run("check-test-strays", "test-strays real", [], root, bin);
      expectStatus(r, 0);
      const verdict = WIN
        ? /^SKIP: the Bash suites run on Linux only/
        : /^OK: \d+ test suites pass the static syntax check/;
      assert.match(lf(r.out), verdict, why(r, "verdict line"));
    });
  });

  it("rejects a suite with a syntax error (SKIP on win32)", () => {
    withBox((root, bin) => {
      const dir = path.join(root, "tree");
      fs.mkdirSync(path.join(dir, "scripts", "tests"), { recursive: true });
      fs.writeFileSync(path.join(dir, "scripts", "tests", "test-broken.sh"), "if then fi (\n");
      const r = run("check-test-strays", "test-strays fixture", [], root, bin, {
        CREWRIG_REPO_DIR: dir,
      });
      if (WIN) {
        expectStatus(r, 0);
        assert.match(lf(r.out), /^SKIP: /, why(r, "skip line"));
      } else {
        expectStatus(r, 1);
        assert.match(
          lf(r.err),
          /^FAILED: test-broken\.sh has syntax errors:/m,
          why(r, "FAILED line"),
        );
      }
    });
  });
});

describe("windows governance repo-scans: check-markdown-links", () => {
  it("accepts the real repository", () => {
    withBox((root, bin) => {
      const r = inDir(repo, () =>
        run("check-markdown-links", "markdown-links real", [], root, bin),
      );
      expectStatus(r, 0);
      assert.match(
        lf(r.out),
        /^All relative Markdown links resolved cleanly\.\n$/,
        why(r, "verdict line"),
      );
    });
  });

  it("rejects a broken relative link with a FAIL line using forward slashes", () => {
    withBox((root, bin) => {
      const dir = makeRepo(root, { "docs/a.md": "[gone](sub/missing.md)\n" });
      const r = inDir(dir, () =>
        run("check-markdown-links", "markdown-links fixture", [], root, bin),
      );
      expectStatus(r, 1);
      const out = lf(r.out);
      assert.match(
        out,
        /^FAIL: docs\/a\.md:1: 'sub\/missing\.md' -> resolved to 'docs\/sub\/missing\.md'/m,
        why(r, "FAIL line"),
      );
      assert.match(out, /^Found 1 broken relative Markdown link\(s\)\./m, why(r, "summary"));
    });
  });
});

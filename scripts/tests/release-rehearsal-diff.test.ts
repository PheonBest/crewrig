// Spec 0257 R26: the pure parts of the rehearsal comparison of the two release drivers. The
// end-to-end run needs the engine and the network, so a CI job runs it, not this file.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import type { GitResult } from "../lib/sync-from-upstream/git.ts";
import {
  checkoutState,
  compareRehearsals,
  ensureNamedBranch,
  extensionSymlinks,
  findSymlinks,
  legEnvironment,
  normalise,
  repositoryFromRemote,
} from "./lib/release-rehearsal-diff.ts";
import type { GitFn, Leg } from "./lib/release-rehearsal-diff.ts";

const CTX = { tmpDirs: ["/tmp", "/var/folders/ab/cd/T"] };
const leg = (stdout: string, status = 0, stderr = ""): Leg => ({ stdout, stderr, status });
const ok = (stdout: string): GitResult => ({ status: 0, stdout, stderr: "" });

describe("compareRehearsals", () => {
  it("reports equal legs as equal with an empty report", () => {
    const verdict = compareRehearsals(leg("a\nb\n"), leg("a\nb\n"));
    assert.deepEqual(verdict, { equal: true, report: "" });
  });

  it("names the first differing line of stdout", () => {
    const verdict = compareRehearsals(leg("a\nb\nc\n"), leg("a\nB\nc\n"));
    assert.equal(verdict.equal, false);
    assert.match(verdict.report, /stdout differs at line 2/);
    assert.match(verdict.report, /-b\n\+B/);
  });

  it("names the first differing line of stderr and a missing trailing line", () => {
    const verdict = compareRehearsals(leg("", 0, "x\ny"), leg("", 0, "x"));
    assert.match(verdict.report, /stderr differs at line 2/);
    assert.match(verdict.report, /<end of output>/);
  });

  it("reports a differing exit status even when the output is equal", () => {
    const verdict = compareRehearsals(leg("same", 0), leg("same", 1));
    assert.equal(verdict.equal, false);
    assert.match(verdict.report, /exit status differs: shell=0 typescript=1/);
    assert.doesNotMatch(verdict.report, /stdout differs/);
  });
});

describe("normalise", () => {
  it("hides the value of sha256= and keeps the surrounding line", () => {
    const hex = "0123456789abcdef".repeat(4);
    const out = normalise(`REHEARSAL x version=1.0.0 sha256=${hex}\nsha256=none`, CTX);
    assert.equal(out, "REHEARSAL x version=1.0.0 sha256=<SHA256>\nsha256=none");
  });

  it("hides a hash inside an archive file name but not its version", () => {
    const out = normalise("archive=ext-1.2.3-deadbeef01.tar.gz sha256=none", CTX);
    assert.equal(out, "archive=ext-1.2.3-<HEX>.tar.gz sha256=none");
    assert.equal(normalise("archive=ext-1.2.3.tar.gz", CTX), "archive=ext-1.2.3.tar.gz");
  });

  it("collapses the scratch directory of either driver, whatever its name", () => {
    assert.equal(normalise("cd /tmp/tmp.Ab12Cd/rehearsal/x", CTX), "cd <SCRATCH>/rehearsal/x");
    assert.equal(
      normalise("cd /var/folders/ab/cd/T/crewrig-release-Q1w2E3/rehearsal/x", CTX),
      "cd <SCRATCH>/rehearsal/x",
    );
    const shown = normalise(`log ${path.join(os.tmpdir(), "crewrig-release-zz9")}/a.log`, {
      tmpDirs: [os.tmpdir()],
    });
    assert.equal(shown, "log <SCRATCH>/a.log");
  });

  it("leaves a path outside the temporary directories alone", () => {
    assert.equal(normalise("/work/repo/scripts/x.ts", CTX), "/work/repo/scripts/x.ts");
  });
});

describe("ensureNamedBranch", () => {
  const fake =
    (head: string, calls: string[][]): GitFn =>
    (args) => {
      calls.push([...args]);
      if (args[0] === "rev-parse" && args.includes("--abbrev-ref")) return ok(`${head}\n`);
      if (args[0] === "rev-parse") return ok("abc123\n");
      return ok("");
    };

  it("does nothing on a named branch", () => {
    const calls: string[][] = [];
    ensureNamedBranch(fake("main", calls)).restore();
    assert.equal(calls.length, 1);
  });

  it("creates rehearsal-diff on a detached HEAD and puts the detached HEAD back", () => {
    const calls: string[][] = [];
    const named = ensureNamedBranch(fake("HEAD", calls));
    assert.deepEqual(calls.at(-1), ["switch", "-C", "rehearsal-diff"]);
    named.restore();
    assert.deepEqual(calls.slice(-2), [
      ["switch", "--detach", "abc123"],
      ["branch", "-D", "rehearsal-diff"],
    ]);
  });

  it("refuses to continue when the branch cannot be created", () => {
    const git: GitFn = (args) =>
      args[0] === "switch"
        ? { status: 128, stdout: "", stderr: "boom" }
        : ok(args.includes("--abbrev-ref") ? "HEAD\n" : "abc\n");
    assert.throws(() => ensureNamedBranch(git), /cannot create rehearsal-diff: boom/);
  });
});

describe("checkoutState and the child environment", () => {
  it("joins the status and the refs so a change to either shows", () => {
    const run =
      (status: string): GitFn =>
      (args) =>
        ok(args[0] === "status" ? status : "refs");
    assert.notEqual(checkoutState(run("")), checkoutState(run("!! build/\n")));
  });

  it("reads owner/name from https and scp-like origins", () => {
    assert.equal(repositoryFromRemote("https://github.com/o/r.git\n"), "o/r");
    assert.equal(repositoryFromRemote("git@github.com:o/r"), "o/r");
    assert.equal(repositoryFromRemote(""), undefined);
  });

  it("strips credentials, CI and release variables, and pins the GitHub shape", () => {
    const env = legEnvironment(
      {
        PATH: "/bin",
        GITHUB_TOKEN: "x",
        GH_TOKEN: "x",
        RELEASE_TOKEN: "x",
        MY_SECRET: "x",
        CI: "true",
        RELEASE_MODE: "publish",
        GITLAB_CI: "true",
        CI_REPOSITORY_URL: "https://u:p@host/r",
      },
      "o/r",
    );
    assert.deepEqual(env, {
      PATH: "/bin",
      GITHUB_ACTIONS: "true",
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_REPOSITORY: "o/r",
      RELEASE_DRY_RUN: "true",
    });
  });
});

describe("symbolic link detection", () => {
  it("finds a link in a nested directory of a temporary tree, and none otherwise", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rehearsal-diff-test-"));
    try {
      const ext = path.join(root, "build", "extensions", "alpha");
      fs.mkdirSync(path.join(ext, "sub"), { recursive: true });
      fs.writeFileSync(path.join(ext, "real.txt"), "x");
      assert.deepEqual(extensionSymlinks(root), []);
      fs.symlinkSync(path.join(ext, "real.txt"), path.join(ext, "sub", "link"));
      assert.deepEqual(findSymlinks(ext), [path.join("sub", "link")]);
      assert.deepEqual(extensionSymlinks(root), ["alpha/sub/link"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("treats a missing build/extensions directory as no link", () => {
    assert.deepEqual(extensionSymlinks(path.join(os.tmpdir(), "does-not-exist-rehearsal")), []);
  });
});

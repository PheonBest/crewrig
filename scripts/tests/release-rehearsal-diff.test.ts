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
  requireSuccessfulRehearsal,
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

  it("names a differing line of stdout", () => {
    const verdict = compareRehearsals(leg("a\nb\nc\n"), leg("a\nB\nc\n"));
    assert.equal(verdict.equal, false);
    assert.match(verdict.report, /stdout differs in 1 line\(s\)/);
    assert.match(verdict.report, /line 2:\n-b\n\+B/);
  });

  it("names a differing line of stderr and a missing trailing line", () => {
    const verdict = compareRehearsals(leg("", 0, "x\ny"), leg("", 0, "x"));
    assert.match(verdict.report, /stderr differs in 1 line\(s\)/);
    assert.match(verdict.report, /line 2:/);
    assert.match(verdict.report, /<end of output>/);
  });

  it("reports every differing line, not only the first", () => {
    const verdict = compareRehearsals(leg("a\nb\nc\nd"), leg("a\nB\nc\nD"));
    assert.match(verdict.report, /stdout differs in 2 line\(s\)/);
    assert.match(verdict.report, /line 2:\n-b\n\+B/);
    assert.match(verdict.report, /line 4:\n-d\n\+D/);
  });

  it("caps the report at 40 lines and says how many more differ", () => {
    const many = (suffix: string): string =>
      Array.from({ length: 55 }, (_, i) => `l${i}${suffix}`).join("\n");
    const report = compareRehearsals(leg(many("a")), leg(many("b"))).report;
    assert.match(report, /stdout differs in 55 line\(s\)/);
    assert.equal((report.match(/^line \d+:$/gm) ?? []).length, 40);
    assert.match(report, /\.\.\. and 15 more differing line\(s\)/);
  });

  it("reports a differing exit status even when the output is equal", () => {
    const verdict = compareRehearsals(leg("same", 0), leg("same", 1));
    assert.equal(verdict.equal, false);
    assert.match(verdict.report, /exit status differs: shell=0 typescript=1/);
    assert.doesNotMatch(verdict.report, /stdout differs/);
  });
});

describe("requireSuccessfulRehearsal", () => {
  const good = "REHEARSAL x version=1.0.0\nUNCHANGED y\nRelease analysis completed successfully.\n";

  it("accepts a successful rehearsal that reached the end of the analysis", () => {
    assert.deepEqual(requireSuccessfulRehearsal("shell", leg(good)), []);
    assert.deepEqual(
      requireSuccessfulRehearsal(
        "shell",
        leg("UNCHANGED y\nRelease analysis completed successfully."),
      ),
      [],
    );
  });

  it("names a non-zero exit status", () => {
    assert.deepEqual(requireSuccessfulRehearsal("typescript", leg(good, 1)), [
      "the typescript leg exited 1, not 0",
    ]);
  });

  it("names a missing REHEARSAL or UNCHANGED line", () => {
    const missing = requireSuccessfulRehearsal(
      "shell",
      leg("noise REHEARSAL x\nRelease analysis completed successfully.\n"),
    );
    assert.equal(missing.length, 1);
    assert.match(missing[0] ?? "", /no "REHEARSAL " or "UNCHANGED " line/);
  });

  it("names a missing closing sentence", () => {
    const missing = requireSuccessfulRehearsal("shell", leg("REHEARSAL x\n"));
    assert.equal(missing.length, 1);
    assert.match(missing[0] ?? "", /did not print "Release analysis completed successfully\."/);
  });

  it("reports every failure at once when both drivers failed identically", () => {
    assert.equal(requireSuccessfulRehearsal("shell", leg("boom", 1)).length, 3);
  });
});

describe("normalise", () => {
  it("hides the engine clock in its 12-hour and 24-hour forms", () => {
    assert.equal(
      normalise("[11:47:52 AM] [semantic-release] › ℹ  Running", CTX),
      "[<TIME>] [semantic-release] › ℹ  Running",
    );
    assert.equal(normalise("[1:02:03 PM] x\n[23:59:59] y", CTX), "[<TIME>] x\n[<TIME>] y");
  });

  it("hides ISO instants and leaves a bare date alone", () => {
    assert.equal(
      normalise("at 2026-10-13T11:47:52.123Z and 2026-10-13T11:47:52+02:00", CTX),
      "at <TIME> and <TIME>",
    );
    assert.equal(normalise("released 2026-10-13", CTX), "released 2026-10-13");
  });

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

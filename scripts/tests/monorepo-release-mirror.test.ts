// monorepo-release-mirror.test.ts — makeMirror and reconcileTags (spec 0257 R17) against a
// throw-away repository, a bare `origin` and no network.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { ReleaseFailure } from "../lib/monorepo-release/failure.ts";
import { makeMirror, mirrorPaths, reconcileTags } from "../lib/monorepo-release/mirror.ts";

const temps: string[] = [];
after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

interface Fixture {
  readonly root: string;
  readonly checkout: string;
  readonly origin: string;
  readonly env: Record<string, string>;
}

function fixture(): Fixture {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-mirror-")));
  temps.push(root);
  fs.mkdirSync(path.join(root, "home"));
  const env: Record<string, string> = {
    PATH: process.env["PATH"] ?? "",
    HOME: path.join(root, "home"),
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_AUTHOR_NAME: "T",
    GIT_AUTHOR_EMAIL: "t@example.invalid",
    GIT_COMMITTER_NAME: "T",
    GIT_COMMITTER_EMAIL: "t@example.invalid",
  };
  const origin = path.join(root, "origin.git");
  const checkout = path.join(root, "checkout");
  fs.mkdirSync(checkout);
  run(root, ["init", "--bare", "-q", "-b", "main", origin], env);
  run(checkout, ["init", "-q", "-b", "main"], env);
  run(checkout, ["remote", "add", "origin", origin], env);
  return { root, checkout, origin, env };
}

function run(cwd: string, args: string[], env: Record<string, string>): string {
  const r = spawnSync("git", args, { cwd, env, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

function commit(f: Fixture, name: string): string {
  fs.writeFileSync(path.join(f.checkout, name), name);
  run(f.checkout, ["add", name], f.env);
  run(f.checkout, ["commit", "-q", "-m", name], f.env);
  return run(f.checkout, ["rev-parse", "HEAD"], f.env);
}

function refs(repo: string, env: Record<string, string>, pattern = ""): string {
  return run(
    repo,
    ["for-each-ref", "--format=%(refname) %(objectname)", ...(pattern === "" ? [] : [pattern])],
    env,
  );
}

function make(f: Fixture): string[] {
  const out: string[] = [];
  const dir = path.join(f.root, "rehearsal");
  fs.mkdirSync(dir);
  makeMirror({
    checkout: f.checkout,
    dir,
    branch: "main",
    forgeUrl: "https://forge.example/o/r.git",
    env: f.env,
    out: (line) => out.push(line),
  });
  return out;
}

describe("makeMirror", () => {
  test("the mirror holds the branch and every tag, the clone is on the branch", () => {
    const f = fixture();
    const first = commit(f, "a");
    run(f.checkout, ["tag", "light-v1.0.0"], f.env);
    run(f.checkout, ["tag", "-a", "-m", "m", "ann-v1.0.0"], f.env);
    const head = commit(f, "b");
    run(f.checkout, ["push", "-q", "origin", "main", "--tags"], f.env);
    const out = make(f);
    const { mirror, clone } = mirrorPaths(path.join(f.root, "rehearsal"));
    const mirrored = refs(mirror, f.env);
    assert.match(mirrored, new RegExp(`refs/heads/main ${head}`));
    assert.match(mirrored, new RegExp(`refs/tags/light-v1.0.0 ${first}`));
    assert.match(mirrored, /refs\/tags\/ann-v1.0.0 /);
    assert.equal(run(mirror, ["symbolic-ref", "HEAD"], f.env), "refs/heads/main");
    assert.equal(run(clone, ["rev-parse", "--abbrev-ref", "HEAD"], f.env), "main");
    assert.equal(run(clone, ["rev-parse", "HEAD"], f.env), head);
    assert.equal(
      run(clone, ["config", `url.${mirror}.insteadOf`], f.env),
      "https://forge.example/o/r.git",
    );
    assert.deepEqual(out, []);
  });

  test("prints the NOTICE line when the branch of origin advanced", () => {
    const f = fixture();
    commit(f, "a");
    run(f.checkout, ["push", "-q", "origin", "main"], f.env);
    commit(f, "b");
    run(f.checkout, ["push", "-q", "origin", "main"], f.env);
    run(f.checkout, ["reset", "-q", "--hard", "HEAD~1"], f.env);
    assert.deepEqual(make(f), ["NOTICE remote branch has advanced; rehearsing HEAD"]);
  });

  test("no NOTICE when origin has no such branch", () => {
    const f = fixture();
    commit(f, "a");
    assert.deepEqual(make(f), []);
  });

  test("the push from the checkout does not run its pre-push hook", () => {
    const f = fixture();
    commit(f, "a");
    const marker = path.join(f.root, "hook-ran");
    const hook = path.join(f.checkout, ".git", "hooks", "pre-push");
    fs.writeFileSync(hook, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
    make(f);
    assert.equal(fs.existsSync(marker), false);
  });

  test("a failing git step is a ReleaseFailure with status 1", () => {
    const f = fixture();
    // No commit: HEAD cannot be pushed.
    assert.throws(
      () => make(f),
      (e: unknown) => e instanceof ReleaseFailure && e.status === 1,
    );
  });
});

describe("reconcileTags", () => {
  function setup(): { f: Fixture; mirror: string } {
    const f = fixture();
    commit(f, "a");
    const mirror = path.join(f.root, "m.git");
    run(f.root, ["init", "--bare", "-q", mirror], f.env);
    return { f, mirror };
  }

  /** Reconcile as makeMirror does: the mirror already holds the history of HEAD, pushed first. */
  function reconcile(f: Fixture, mirror: string): void {
    run(f.checkout, ["push", "--no-verify", "-q", mirror, "HEAD:refs/heads/main"], f.env);
    reconcileTags(mirror, f.checkout, f.env);
  }

  /** Publish `sha` as a remote-only tag: made in a scratch clone of the checkout, pushed, removed. */
  function remoteOnlyTag(f: Fixture, name: string, sha: string, annotated: boolean): void {
    run(f.checkout, ["push", "-q", "origin", `${sha}:refs/heads/tmp-${name}`], f.env);
    const args = annotated ? ["tag", "-a", "-m", "m", name, sha] : ["tag", name, sha];
    run(f.checkout, args, f.env);
    run(f.checkout, ["push", "-q", "origin", `refs/tags/${name}`], f.env);
    run(f.checkout, ["tag", "-d", name], f.env);
  }

  test("adds a remote tag whose commit is local and an ancestor of HEAD", () => {
    const { f, mirror } = setup();
    const base = run(f.checkout, ["rev-parse", "HEAD"], f.env);
    commit(f, "b");
    remoteOnlyTag(f, "x-v1.0.0", base, false);
    reconcile(f, mirror);
    assert.equal(run(mirror, ["rev-parse", "refs/tags/x-v1.0.0"], f.env), base);
  });

  test("resolves an annotated tag to its peeled commit", () => {
    const { f, mirror } = setup();
    const base = run(f.checkout, ["rev-parse", "HEAD"], f.env);
    commit(f, "b");
    remoteOnlyTag(f, "x-v2.0.0", base, true);
    reconcile(f, mirror);
    assert.equal(run(mirror, ["rev-parse", "refs/tags/x-v2.0.0"], f.env), base);
    assert.equal(run(mirror, ["cat-file", "-t", "refs/tags/x-v2.0.0"], f.env), "commit");
  });

  test("skips a tag whose commit is not an ancestor of HEAD", () => {
    const { f, mirror } = setup();
    run(f.checkout, ["checkout", "-q", "-b", "side"], f.env);
    const side = commit(f, "side");
    run(f.checkout, ["checkout", "-q", "main"], f.env);
    commit(f, "b");
    remoteOnlyTag(f, "x-v3.0.0", side, false);
    reconcile(f, mirror);
    assert.equal(refs(mirror, f.env, "refs/tags"), "");
  });

  test("skips a tag whose commit is absent from the checkout", () => {
    const { f, mirror } = setup();
    const other = path.join(f.root, "other");
    fs.mkdirSync(other);
    run(other, ["clone", "-q", f.origin, "."], f.env);
    fs.writeFileSync(path.join(other, "z"), "z");
    run(other, ["add", "z"], f.env);
    run(other, ["commit", "-q", "-m", "z"], f.env);
    run(other, ["tag", "x-v4.0.0"], f.env);
    run(other, ["push", "-q", f.origin, "refs/tags/x-v4.0.0"], f.env);
    reconcile(f, mirror);
    assert.equal(refs(mirror, f.env, "refs/tags"), "");
  });

  test("leaves a tag the checkout already has alone", () => {
    const { f, mirror } = setup();
    run(f.checkout, ["tag", "x-v5.0.0"], f.env);
    run(f.checkout, ["push", "-q", "origin", "refs/tags/x-v5.0.0"], f.env);
    reconcile(f, mirror);
    assert.equal(refs(mirror, f.env, "refs/tags"), "");
  });

  test("an unreadable origin is a ReleaseFailure of status 1 with the shell's message", () => {
    const { f, mirror } = setup();
    run(f.checkout, ["remote", "set-url", "origin", path.join(f.root, "absent.git")], f.env);
    assert.throws(
      () => reconcileTags(mirror, f.checkout, f.env),
      (e: unknown) =>
        e instanceof ReleaseFailure &&
        e.status === 1 &&
        e.message === "rehearsal cannot list the tags of origin",
    );
  });
});

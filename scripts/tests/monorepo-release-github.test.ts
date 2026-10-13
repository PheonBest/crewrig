// Spec 0257 R14: the GitHub release-PR flow, classification and prepare steps, driven with a fake
// mirror, a fake engine, a fake git and a fake `release-pr.ts`.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { releaseGithub } from "../lib/monorepo-release/flow-github.ts";
import { disposeHarness, entriesOf, NEXT, setup } from "./lib/release-github-fixture.ts";

afterEach(disposeHarness);

describe("releaseGithub classification", () => {
  it("reports UNCHANGED, publishes a merged release and lists a pending one", async () => {
    const { h, engine, git, sync, published, deps } = setup({
      alpha: { classify: { json: { released: false } } },
      beta: { manifest: "1.1.0", classify: { json: NEXT } },
      gamma: { classify: { json: NEXT }, prepare: { json: NEXT } },
    });
    await releaseGithub(h.ctx, deps);

    assert.deepEqual(h.stdout, [
      "",
      "--- Analyzing: alpha ---",
      "UNCHANGED alpha",
      "",
      "--- Analyzing: beta ---",
      "",
      "--- Analyzing: gamma ---",
      "",
      "--- Analyzing: beta ---",
      "Running semantic-release for beta...",
      "UNCHANGED beta",
      "",
      "--- Preparing the release PR: gamma ---",
      "PENDING gamma version=1.1.0 tag=alpha-v1.1.0",
      "RELEASE-PR-BRANCH release-pr/main",
    ]);
    // releasePublish runs from the checkout, on the directory the clone classified as publish.
    assert.deepEqual(published, [path.join(h.root, "extensions/core/beta")]);
    assert.deepEqual(
      engine.map((run) => [path.basename(run.dir), run.apply]),
      [
        ["alpha", false],
        ["beta", false],
        ["gamma", false],
        ["gamma", true],
      ],
    );
    assert.equal(
      entriesOf(h),
      `${JSON.stringify([{ ext: "gamma", version: "1.1.0", tag: "alpha-v1.1.0", notes: "## 1.1.0" }], null, 2)}\n`,
    );
    assert.deepEqual(
      git.map((call) => call.args),
      [
        ["fetch", "-q", path.join(h.ctx.scratch.dir, "release-pr/clone"), "refs/heads/main"],
        ["push", "--no-verify", "--force", "-q", "origin", "FETCH_HEAD:refs/heads/release-pr/main"],
      ],
    );
    assert.ok(git.every((call) => call.cwd === h.root));
    assert.deepEqual(sync, [
      {
        argv: [
          "sync",
          "main",
          "release-pr/main",
          path.join(h.ctx.scratch.dir, "release-pr/entries.json"),
        ],
        cwd: h.root,
        scriptsDir: h.ctx.scriptsDir,
      },
    ]);
    assert.equal(h.ctx.errors, 0);
  });

  it("passes the clone-relative directory with a trailing slash to the publish flow", async () => {
    const { h, deps } = setup({ beta: { manifest: "1.1.0", classify: { json: NEXT } } });
    const seen: string[] = [];
    await releaseGithub(h.ctx, {
      ...deps,
      runSemanticRelease: (opts) => {
        seen.push(path.relative(h.root, opts.dir));
        return Promise.resolve({ status: 0, output: "" });
      },
    });
    assert.deepEqual(seen, ["extensions/core/beta"]);
  });

  it("builds the mirror from the forge URL and prints the clone-modules notice once", async () => {
    const { h, deps } = setup({});
    const urls: string[] = [];
    await releaseGithub(h.ctx, {
      ...deps,
      makeMirror: (opts) => {
        urls.push(opts.forgeUrl);
      },
      stageCloneModules: () => [{ method: "fallback-copy", dest: "d", source: "s", code: "EPERM" }],
    });
    assert.deepEqual(urls, ["https://github.example/o/r.git"]);
    assert.equal(h.stderr.length, 1);
    assert.match(h.stderr[0] ?? "", /EPERM/);
  });
});

describe("releaseGithub prepare step", () => {
  it("resets and cleans the clone after a failed extension, and maps the failed step", async () => {
    const { h, git, sync, deps } = setup({
      alpha: {
        classify: { json: NEXT },
        prepare: { status: 1, log: '[x] Failed step "prepare" of plugin "@semantic-release/git"' },
      },
      beta: { classify: { json: NEXT }, prepare: { json: { ...NEXT, gitTag: "beta-v1.1.0" } } },
    });
    await releaseGithub(h.ctx, deps);
    const clone = path.join(h.ctx.scratch.dir, "release-pr/clone");
    assert.ok(h.stdout.includes("RELEASE-FAILED alpha step=commit"));
    assert.ok(h.stdout.includes("PENDING beta version=1.1.0 tag=beta-v1.1.0"));
    assert.deepEqual(
      git.slice(0, 2).map((call) => call.args),
      [
        ["-C", clone, "reset", "-q", "--hard"],
        ["-C", clone, "clean", "-q", "-fd"],
      ],
    );
    assert.equal(h.ctx.errors, 1);
    // One extension is still proposed, so the branch is pushed and the PR synced.
    assert.equal(sync.length, 1);
    const entries = JSON.parse(entriesOf(h)) as Array<{ ext: string }>;
    assert.deepEqual(
      entries.map((e) => e.ext),
      ["beta"],
    );
  });

  it("treats released !== true as a failure whose step comes from the log, engine by default", async () => {
    const { h, git, deps } = setup({
      alpha: { classify: { json: NEXT }, prepare: { json: { released: false } } },
    });
    await releaseGithub(h.ctx, deps);
    assert.ok(h.stdout.includes("RELEASE-FAILED alpha step=engine"));
    assert.equal(git.length, 2);
    assert.equal(h.ctx.errors, 1);
  });

  it("maps a failed package step", async () => {
    const { h, deps } = setup({
      alpha: {
        classify: { json: NEXT },
        prepare: {
          status: 1,
          log: 'Failed step "prepare" of plugin "@semantic-release/exec"',
        },
      },
    });
    await releaseGithub(h.ctx, deps);
    assert.ok(h.stdout.includes("RELEASE-FAILED alpha step=package"));
  });
});

// Spec 0257 R14: the GitHub release-PR flow, push and sync steps, environment and abort.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { releaseGithub } from "../lib/monorepo-release/flow-github.ts";
import { disposeHarness, entriesOf, NEXT, setup } from "./lib/release-github-fixture.ts";

afterEach(disposeHarness);

describe("releaseGithub push and sync", () => {
  it("reports a failed fetch as step=push and does not sync", async () => {
    const { h, sync, deps } = setup(
      { alpha: { classify: { json: NEXT }, prepare: { json: NEXT } } },
      { gitFails: "fetch" },
    );
    await releaseGithub(h.ctx, deps);
    assert.equal(h.stdout.at(-1), "RELEASE-FAILED release-pr step=push");
    assert.equal(h.stdout.includes("RELEASE-PR-BRANCH release-pr/main"), false);
    assert.equal(h.ctx.errors, 1);
    assert.deepEqual(sync, []);
  });

  it("reports a failed push as step=push", async () => {
    const { h, sync, deps } = setup(
      { alpha: { classify: { json: NEXT }, prepare: { json: NEXT } } },
      { gitFails: "push" },
    );
    await releaseGithub(h.ctx, deps);
    assert.equal(h.stdout.at(-1), "RELEASE-FAILED release-pr step=push");
    assert.deepEqual(sync, []);
  });

  it("reports a failed sync as step=pr", async () => {
    const { h, deps } = setup(
      { alpha: { classify: { json: NEXT }, prepare: { json: NEXT } } },
      { syncStatus: 3 },
    );
    await releaseGithub(h.ctx, deps);
    assert.equal(h.stdout.at(-1), "RELEASE-FAILED release-pr step=pr");
    assert.equal(h.ctx.errors, 1);
  });

  it("syncs with an empty entries list, without a push, when nothing is pending", async () => {
    const { h, git, sync, deps } = setup({ alpha: { classify: { json: { released: false } } } });
    await releaseGithub(h.ctx, deps);
    assert.deepEqual(git, []);
    assert.equal(sync.length, 1);
    assert.equal(entriesOf(h), "[]\n");
    assert.equal(h.stdout.includes("RELEASE-PR-BRANCH release-pr/main"), false);
    assert.equal(h.ctx.errors, 0);
  });

  it("returns without syncing when an engine failure left nothing to propose", async () => {
    const { h, git, sync, deps } = setup({
      alpha: { classify: { status: 1 } },
      beta: { classify: { json: { released: false } } },
    });
    await releaseGithub(h.ctx, deps);
    assert.ok(h.stdout.includes("RELEASE-FAILED alpha step=engine"));
    assert.deepEqual(git, []);
    assert.deepEqual(sync, []);
    assert.equal(h.ctx.errors, 1);
  });

  it("returns without syncing when the only pending extension failed to prepare", async () => {
    const { h, sync, deps } = setup({
      alpha: { classify: { json: NEXT }, prepare: { status: 1 } },
    });
    await releaseGithub(h.ctx, deps);
    assert.deepEqual(sync, []);
  });

  it("still pushes and syncs when a classification failed but another extension is pending", async () => {
    const { h, sync, deps } = setup({
      alpha: { classify: { status: 1 } },
      beta: { classify: { json: NEXT }, prepare: { json: NEXT } },
    });
    await releaseGithub(h.ctx, deps);
    assert.equal(sync.length, 1);
    assert.equal(h.ctx.errors, 1);
  });
});

describe("releaseGithub environment and abort", () => {
  it("strips credentials from every engine environment and keeps them for the push and the sync", async () => {
    const { h, engine, deps } = setup(
      { alpha: { classify: { json: NEXT }, prepare: { json: NEXT } } },
      { env: { GITHUB_TOKEN: "t", MY_SECRET: "s", KEEP: "k" } },
    );
    const gitEnvs: Array<string | undefined> = [];
    const syncEnvs: Array<string | undefined> = [];
    await releaseGithub(h.ctx, {
      ...deps,
      runGit: (args, opts) => {
        gitEnvs.push(opts.env["GITHUB_TOKEN"]);
        return deps.runGit(args, opts);
      },
      runReleasePr: (argv, opts) => {
        syncEnvs.push(opts.env["GITHUB_TOKEN"]);
        return deps.runReleasePr(argv, opts);
      },
    });
    assert.equal(engine.length, 2);
    for (const run of engine) {
      assert.equal(run.env["GITHUB_TOKEN"], undefined);
      assert.equal(run.env["MY_SECRET"], undefined);
      assert.equal(run.env["KEEP"], "k");
    }
    assert.deepEqual(gitEnvs, ["t", "t"]);
    assert.deepEqual(syncEnvs, ["t"]);
    // The engine log is forwarded to standard error.
    assert.equal(h.rawErr.join(""), "engine log\nengine log\n");
  });

  it("removes the releaserc of every engine run and logs the engine stderr per mode", async () => {
    const { h, engine, deps } = setup({
      alpha: { classify: { json: NEXT }, prepare: { json: NEXT } },
    });
    await releaseGithub(h.ctx, deps);
    for (const run of engine) assert.equal(fs.existsSync(run.releasercPath), false);
    assert.deepEqual(
      engine.map((run) => path.basename(run.logFile ?? "")),
      ["alpha.rehearsal.log", "alpha.prepare.log"],
    );
  });

  it("stops the loops once aborted", async () => {
    let calls = 0;
    const { h, engine, sync, deps } = setup(
      { alpha: { classify: { json: NEXT } }, beta: { classify: { json: NEXT } } },
      { aborted: () => calls++ >= 1 },
    );
    await releaseGithub(h.ctx, deps);
    assert.deepEqual(
      engine.map((run) => path.basename(run.dir)),
      ["alpha"],
    );
    assert.equal(h.stdout.includes("--- Analyzing: beta ---"), false);
    assert.deepEqual(sync, []);
  });
});

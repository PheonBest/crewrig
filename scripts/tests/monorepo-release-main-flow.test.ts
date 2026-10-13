// Spec 0257 R14, R19: the driver's `main`, dispatch, environment, summary and exit status.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { ReleaseFailure } from "../lib/monorepo-release/failure.ts";
import type { FlowDeps } from "../lib/monorepo-release/flow-deps.ts";
import {
  checkout,
  GITHUB,
  GITLAB,
  initRepo,
  run,
  useCheckout,
} from "./lib/release-main-fixture.ts";
import type { Env } from "./lib/release-main-fixture.ts";

useCheckout();

describe("main dispatch and environment", () => {
  it("prints Forge, Mode and Branch, then the summary, and exits 0", async () => {
    const result = await run(GITLAB);
    assert.equal(result.code, 0);
    assert.deepEqual(result.out, [
      "Forge: gitlab",
      "Mode: publish",
      "Branch: main",
      "",
      "Release analysis completed successfully.",
    ]);
    assert.deepEqual(result.err, []);
  });

  it("takes the github branch from the checkout and runs the release-PR flow", async () => {
    initRepo("main");
    const result = await run(GITHUB);
    assert.equal(result.code, 0);
    assert.deepEqual(result.out.slice(0, 3), ["Forge: github", "Mode: publish", "Branch: main"]);
    assert.equal(result.seen.mirrorDirs.length, 1);
    assert.equal(path.basename(result.seen.mirrorDirs[0] ?? ""), "release-pr");
    // The directory of the entry file is the scripts directory of the checkout.
    assert.deepEqual(result.seen.syncs, [{ scriptsDir: path.join(checkout, "scripts") }]);
  });

  it("runs the rehearsal for either mode alias, on both forges", async () => {
    initRepo("main");
    for (const env of [
      { ...GITHUB, RELEASE_DRY_RUN: "true" },
      { ...GITLAB, DRY_RUN: "true" },
    ]) {
      const result = await run(env);
      assert.equal(result.out[1], "Mode: rehearsal");
      assert.equal(path.basename(result.seen.mirrorDirs[0] ?? ""), "rehearsal");
      assert.deepEqual(result.seen.syncs, []);
      assert.equal(result.code, 0);
    }
  });

  it("exports NODE_PATH of the checkout to the children", async () => {
    const result = await run({ ...GITLAB, DRY_RUN: "true", NODE_PATH: "/elsewhere" });
    assert.equal(result.seen.mirrorEnvs[0]?.["NODE_PATH"], path.join(checkout, "node_modules"));
  });

  it("defaults the git identity on github only, keeping one the caller set", async () => {
    initRepo("main");
    const github = await run({ ...GITHUB, RELEASE_DRY_RUN: "true", GIT_AUTHOR_NAME: "me" });
    const env = github.seen.mirrorEnvs[0];
    assert.equal(env?.["GIT_AUTHOR_NAME"], "me");
    assert.equal(env?.["GIT_COMMITTER_NAME"], "github-actions[bot]");
    assert.equal(env?.["GIT_COMMITTER_EMAIL"], "github-actions[bot]@users.noreply.github.com");
    const gitlab = await run({ ...GITLAB, DRY_RUN: "true" });
    assert.equal(gitlab.seen.mirrorEnvs[0]?.["GIT_AUTHOR_NAME"], undefined);
  });

  it("merges the portable credential in publish mode only", async () => {
    initRepo("main");
    const publish = await run({ ...GITHUB, GITHUB_TOKEN: "", RELEASE_TOKEN: "portable" });
    assert.equal(publish.code, 0);
    assert.equal(publish.seen.mirrorEnvs[0]?.["GITHUB_TOKEN"], "portable");
    const rehearsal = await run({
      ...GITHUB,
      GITHUB_TOKEN: "",
      RELEASE_TOKEN: "portable",
      RELEASE_DRY_RUN: "true",
    });
    // The rehearsal leaves the environment as it was: the empty GITHUB_TOKEN is not replaced.
    assert.equal(rehearsal.seen.mirrorEnvs[0]?.["GITHUB_TOKEN"], "");
  });
});

describe("main summary and failures", () => {
  const failing = (over: Partial<FlowDeps> = {}): Partial<FlowDeps> => ({
    makeMirror: (opts) => {
      const dir = path.join(opts.dir, "clone", "extensions", "core", "alpha");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "package.json"), "{}\n");
    },
    runRehearse: () => Promise.resolve({ status: 1, json: "" }),
    ...over,
  });

  it("reports the errors and exits 1 when a flow recorded a failure", async () => {
    initRepo("main");
    const result = await run(GITHUB, failing());
    assert.equal(result.code, 1);
    assert.deepEqual(result.out.slice(-3), [
      "RELEASE-FAILED alpha step=engine",
      "",
      "Release analysis completed WITH ERRORS.",
    ]);
  });

  it("prints a ReleaseFailure as an error and exits 1", async () => {
    initRepo("main");
    const result = await run(GITHUB, {
      makeMirror: () => {
        throw new ReleaseFailure("git init failed: nope");
      },
    });
    assert.equal(result.code, 1);
    assert.deepEqual(result.err, ["Error: git init failed: nope"]);
    assert.equal(result.out.includes("Release analysis completed successfully."), false);
  });

  it("exits 1 on any other error from a flow", async () => {
    initRepo("main");
    const result = await run(GITHUB, {
      makeMirror: () => {
        throw new Error("disk on fire");
      },
    });
    assert.equal(result.code, 1);
    assert.deepEqual(result.err, ["Error: disk on fire"]);
  });

  it("removes the scratch directory after a success and after a failing flow", async () => {
    initRepo("main");
    const ok = await run(GITHUB);
    const scratch = path.dirname(ok.seen.mirrorDirs[0] ?? "");
    assert.equal(fs.existsSync(scratch), false);

    let thrown = "";
    const bad = await run(GITHUB, {
      makeMirror: (opts) => {
        thrown = path.dirname(opts.dir);
        assert.equal(fs.existsSync(thrown), true);
        throw new ReleaseFailure("boom");
      },
    });
    assert.equal(bad.code, 1);
    assert.notEqual(thrown, "");
    assert.equal(fs.existsSync(thrown), false);
  });

  it("uninstalls its signal handlers", async () => {
    const before = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
    await run(GITLAB);
    assert.deepEqual([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")], before);
  });
});

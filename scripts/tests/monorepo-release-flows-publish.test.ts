// Spec 0257 R14: the publish flow, driven with a fake engine over a throw-away root.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { realDeps } from "../lib/monorepo-release/flow-deps.ts";
import type { FlowDeps } from "../lib/monorepo-release/flow-deps.ts";
import { releasePublish } from "../lib/monorepo-release/flow-gitlab.ts";
import type { SemanticReleaseOptions } from "../lib/monorepo-release/engine.ts";
import { makeFlowHarness } from "./lib/release-flow-ctx.ts";
import type { FlowHarness } from "./lib/release-flow-ctx.ts";

type Reply = { status: number; output: string; archive?: string };

interface Seen extends SemanticReleaseOptions {
  releaserc: Record<string, unknown>;
  outExisted: boolean;
}

/** A fake engine answering from `replies` by extension name, recording what it was given. */
function fakeDeps(replies: Record<string, Reply>, seen: Seen[] = []): FlowDeps {
  return {
    ...realDeps,
    sha256File: (file) => `sha(${path.basename(file)})`,
    runSemanticRelease: (opts) => {
      const ext = path.basename(opts.dir);
      const reply = replies[ext] ?? { status: 0, output: "" };
      const out = path.join(opts.dir, "..", "..", "..", "dist", "release", ext);
      seen.push({
        ...opts,
        releaserc: JSON.parse(fs.readFileSync(opts.releasercPath, "utf8")) as Record<
          string,
          unknown
        >,
        outExisted: fs.existsSync(out),
      });
      if (reply.archive !== undefined) fs.writeFileSync(path.join(out, reply.archive), "x");
      fs.appendFileSync(opts.logFile, reply.output);
      opts.out(reply.output);
      return Promise.resolve({ status: reply.status, output: reply.output });
    },
  };
}

let harness: FlowHarness | undefined;
afterEach(() => harness?.dispose());

function setup(opts: Parameters<typeof makeFlowHarness>[0] = {}): FlowHarness {
  harness = makeFlowHarness(opts);
  return harness;
}

const failed = (type: string, plugin: string, more = ""): string =>
  `[semantic-release] Failed step "${type}" of plugin "${plugin}"\n${more}`;

describe("releasePublish report lines", () => {
  it("maps every failed step and reports a tag the run created", async () => {
    const h = setup();
    const cases: Array<[string, string, string]> = [
      ["a-exec", failed("prepare", "@semantic-release/exec"), "package"],
      ["b-git", failed("prepare", "@semantic-release/git"), "commit"],
      [
        "c-upload",
        failed("publish", "@semantic-release/gitlab", "GitLab generics package API"),
        "upload",
      ],
      ["d-release", failed("publish", "@semantic-release/gitlab", "GitLab release API"), "release"],
      ["e-gitlab", failed("publish", "@semantic-release/gitlab"), "engine"],
      ["f-github", failed("publish", "@semantic-release/github"), "release"],
      ["g-verify", failed("verifyConditions", "@semantic-release/gitlab"), "verify"],
      ["h-other", failed("analyzeCommits", "x"), "engine"],
      ["i-none", "boom\n", "engine"],
    ];
    const replies: Record<string, Reply> = {};
    for (const [ext, output] of cases) {
      h.addExtension("core", ext);
      replies[ext] = { status: 1, output };
    }
    h.addExtension("core", "j-tagged");
    replies["j-tagged"] = {
      status: 1,
      output: `Created tag j-tagged-v1.0.0\n${failed("publish", "@semantic-release/github")}`,
    };
    await releasePublish(h.ctx, undefined, fakeDeps(replies));
    const lines = h.stdout.filter((l) => l.startsWith("RELEASE-"));
    assert.deepEqual(lines, [
      ...cases.map(([ext, , step]) => `RELEASE-FAILED ${ext} step=${step}`),
      "RELEASE-FAILED j-tagged step=release",
      "RELEASE-INCOMPLETE-TAG j-tagged-v1.0.0",
    ]);
    assert.equal(h.ctx.errors, 1);
  });

  it("prints PUBLISHED with and without an archive, and UNCHANGED, in byte order", async () => {
    const h = setup();
    h.addExtension("core", "beta");
    h.addExtension("core", "alpha");
    h.addExtension("core", "gamma");
    h.addExtension("core", "nopackage");
    fs.rmSync(path.join(h.root, "extensions/core/nopackage/package.json"));
    const deps = fakeDeps({
      alpha: { status: 0, output: "Created tag alpha-v1.2.3\n", archive: "z.tar.gz" },
      beta: { status: 0, output: "Created tag beta-v2.0.0\n" },
      gamma: { status: 0, output: "nothing to release\n" },
    });
    await releasePublish(h.ctx, undefined, deps);
    assert.deepEqual(h.stdout, [
      "",
      "--- Analyzing: alpha ---",
      "Running semantic-release for alpha...",
      "PUBLISHED alpha tag=alpha-v1.2.3 archive=z.tar.gz sha256=sha(z.tar.gz)",
      "",
      "--- Analyzing: beta ---",
      "Running semantic-release for beta...",
      "PUBLISHED beta tag=beta-v2.0.0 archive=none sha256=none",
      "",
      "--- Analyzing: gamma ---",
      "Running semantic-release for gamma...",
      "UNCHANGED gamma",
    ]);
    assert.equal(h.ctx.errors, 0);
    assert.deepEqual(h.raw, [
      "Created tag alpha-v1.2.3\n",
      "Created tag beta-v2.0.0\n",
      "nothing to release\n",
    ]);
  });

  it("publishes only the given directories, relative to the root", async () => {
    const h = setup();
    h.addExtension("core", "alpha");
    h.addExtension("core", "beta");
    const seen: Seen[] = [];
    await releasePublish(h.ctx, ["extensions/core/beta/"], fakeDeps({}, seen));
    assert.deepEqual(
      seen.map((s) => path.basename(s.dir)),
      ["beta"],
    );
  });
});

describe("releasePublish files and environment", () => {
  it("writes the releaserc for the engine, removes it after, logs under the scratch directory", async () => {
    const h = setup();
    h.addExtension("core", "alpha");
    const seen: Seen[] = [];
    await releasePublish(
      h.ctx,
      undefined,
      fakeDeps({ alpha: { status: 0, output: "hi\n" } }, seen),
    );
    const [run] = seen;
    assert.ok(run);
    assert.equal(run.branch, "main");
    assert.equal(run.releasercPath, path.join(h.root, "dist/release/alpha.releaserc.json"));
    assert.equal(run.releaserc["tagFormat"], "alpha-v${version}");
    assert.equal(run.logFile, path.join(h.ctx.scratch.dir, "publish-logs", "alpha.log"));
    assert.equal(fs.readFileSync(run.logFile, "utf8"), "hi\n");
    assert.equal(run.outExisted, true);
  });

  it("applies the credential-helper override on GitLab only", async () => {
    const gitlab = setup({ env: { GIT_CONFIG_COUNT: "2" } });
    gitlab.addExtension("core", "alpha");
    const seen: Seen[] = [];
    await releasePublish(gitlab.ctx, undefined, fakeDeps({}, seen));
    assert.equal(seen[0]?.env["GIT_CONFIG_KEY_2"], "credential.helper");
    assert.equal(seen[0]?.env["GIT_CONFIG_VALUE_2"], "");
    assert.equal(seen[0]?.env["GIT_CONFIG_COUNT"], "3");
    assert.equal(gitlab.ctx.env["GIT_CONFIG_COUNT"], "2");
    gitlab.dispose();

    const github = setup({ forge: "github" });
    github.addExtension("core", "alpha");
    const seenGh: Seen[] = [];
    await releasePublish(github.ctx, undefined, fakeDeps({}, seenGh));
    assert.equal(seenGh[0]?.env["GIT_CONFIG_COUNT"], undefined);
    assert.equal(seenGh[0]?.env["GIT_CONFIG_KEY_0"], undefined);
  });

  it("removes the whole dist/ it created, but only its own output when dist/ existed", async () => {
    const created = setup();
    created.addExtension("core", "alpha");
    await releasePublish(created.ctx, undefined, fakeDeps({}));
    assert.equal(fs.existsSync(path.join(created.root, "dist")), false);
    created.dispose();

    const existed = setup();
    existed.addExtension("core", "alpha");
    fs.mkdirSync(path.join(existed.root, "dist/release/keep"), { recursive: true });
    fs.writeFileSync(path.join(existed.root, "dist/other"), "x");
    await releasePublish(existed.ctx, undefined, fakeDeps({}));
    assert.deepEqual(fs.readdirSync(path.join(existed.root, "dist")).sort(), ["other", "release"]);
    assert.deepEqual(fs.readdirSync(path.join(existed.root, "dist/release")), ["keep"]);
  });

  it("cleans dist/ even when the engine throws", async () => {
    const h = setup();
    h.addExtension("core", "alpha");
    const deps: FlowDeps = {
      ...realDeps,
      runSemanticRelease: () => Promise.reject(new Error("boom")),
    };
    await assert.rejects(releasePublish(h.ctx, undefined, deps), /boom/);
    assert.equal(fs.existsSync(path.join(h.root, "dist")), false);
  });

  it("stops the extension loop once the run is aborted", async () => {
    let calls = 0;
    const h = setup({ aborted: () => calls > 0 });
    h.addExtension("core", "alpha");
    h.addExtension("core", "beta");
    const seen: Seen[] = [];
    const base = fakeDeps({}, seen);
    const deps: FlowDeps = {
      ...base,
      runSemanticRelease: (opts) => {
        calls += 1;
        return base.runSemanticRelease(opts);
      },
    };
    await releasePublish(h.ctx, undefined, deps);
    assert.equal(seen.length, 1);
    assert.equal(h.stdout.includes("--- Analyzing: beta ---"), false);
  });
  it("reports nothing for an engine child killed by the driver's own signal", async () => {
    let signalled = false;
    const h = setup({ aborted: () => signalled });
    h.addExtension("core", "alpha");
    h.addExtension("core", "beta");
    const deps: FlowDeps = {
      ...fakeDeps({}),
      runSemanticRelease: () => {
        signalled = true;
        return Promise.resolve({ status: 143, output: failed("verifyConditions", "x") });
      },
    };
    await releasePublish(h.ctx, undefined, deps);
    assert.equal(
      h.stdout.some((line) => line.startsWith("RELEASE-FAILED")),
      false,
    );
    assert.equal(h.ctx.errors, 0);
  });
});

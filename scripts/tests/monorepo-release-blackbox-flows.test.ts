// monorepo-release-blackbox-flows.test.ts — group (g) of spec 0257 R22: the GitHub release-PR flow
// of the real release driver, from the outside (classification table, `prepare` config, release
// branch, manifest sync) plus the SemVer refusal of the rehearsal. The driver runs in the sandbox
// with the engine and the forge replaced by capturing stubs; the release-PR sync talks to the
// repository's forge stub over a loopback port. Every assertion is leg-agnostic.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  GITHUB_PUBLISH,
  commitRemoval,
  manifestVersion,
  originRefs,
  pluginOf,
  showFromOrigin,
  startForgeStub,
} from "./lib/release-flow-support.ts";
import { forEachLeg } from "./lib/release-blackbox-legs.ts";
import { createReleaseSandbox } from "./lib/release-driver-sandbox.ts";
import type { ReleaseSandbox } from "./lib/release-driver-sandbox.ts";

const THREE = [
  { name: "second-ext", version: "0.4.0" },
  { name: "third-ext", version: "0.5.0" },
];

/** The engine calls of one extension, in order, each with its parsed config and its apply flag. */
function engineCalls(sb: ReleaseSandbox, ext: string) {
  return sb
    .readJsonl("rehearse")
    .filter((c) => c["ext"] === ext)
    .map((c) => ({
      apply: (c["argv"] as string[])[2] === "apply",
      config: JSON.parse(String(c["config"])) as unknown,
    }));
}

describe("monorepo release driver, black box: group (g) GitHub release-PR flow", () => {
  forEachLeg((leg) => {
    it(`[${leg}] rb-g-classify-table: unchanged, publish and pending in one run`, async () => {
      const sb = createReleaseSandbox({ extraExtensions: THREE });
      const stub = await startForgeStub();
      try {
        const helloVersion = manifestVersion(sb, "hello-world");
        sb.scriptRehearse({
          "hello-world": {
            released: true,
            version: helloVersion,
            gitTag: `hello-world-v${helloVersion}`,
            lastTag: `hello-world-v${helloVersion}`,
          },
          "second-ext": {
            released: true,
            version: "0.9.0",
            gitTag: "second-ext-v0.9.0",
            lastTag: "second-ext-v0.4.0",
            notes: "## second",
          },
          "third-ext": { released: false },
        });
        sb.scriptNpx({ "hello-world": [`Created tag hello-world-v${helloVersion}`] });
        const res = sb.run(leg, { ...GITHUB_PUBLISH, GITHUB_API_URL: stub.apiUrl });
        const out = res.stdout;
        assert.equal(res.status, 0, out + res.stderr);
        const lines = out.split("\n");
        assert.ok(lines.includes("UNCHANGED third-ext"), "the unchanged outcome is absent");
        assert.ok(
          lines.includes(
            `PUBLISHED hello-world tag=hello-world-v${helloVersion} archive=none sha256=none`,
          ),
          "the publish outcome is absent",
        );
        assert.ok(
          lines.includes("PENDING second-ext version=0.9.0 tag=second-ext-v0.9.0"),
          "the pending outcome is absent",
        );
        assert.equal(lines.filter((l) => /^(UNCHANGED|PUBLISHED|PENDING) /.test(l)).length, 3);
        // Three classification runs plus one `apply` run for the pending extension.
        assert.equal(sb.readJsonl("rehearse").length, 4);
        assert.equal(engineCalls(sb, "second-ext").filter((c) => c.apply).length, 1);
        assert.equal(sb.readJsonl("npx").length, 1, "only the publish extension reaches npx");
      } finally {
        stub.stop();
        sb.dispose();
      }
    });

    it(`[${leg}] rb-g-prepare-config: the pending run carries no publish leg and packages nothing`, async () => {
      const sb = createReleaseSandbox();
      const stub = await startForgeStub();
      try {
        sb.scriptRehearse({
          "hello-world": { released: true, version: "9.0.0", gitTag: "hello-world-v9.0.0" },
          "second-ext": { released: false },
        });
        const res = sb.run(leg, { ...GITHUB_PUBLISH, GITHUB_API_URL: stub.apiUrl });
        assert.equal(res.status, 0, res.stdout + res.stderr);
        const applied = engineCalls(sb, "hello-world").filter((c) => c.apply);
        assert.equal(applied.length, 1, "exactly one apply run");
        const config = applied[0]?.config;
        assert.equal(pluginOf(config, "@semantic-release/github"), undefined);
        assert.equal(pluginOf(config, "@semantic-release/gitlab"), undefined);
        const git = pluginOf(config, "@semantic-release/git");
        assert.ok(git !== undefined, "the git plugin is present");
        const message = String(git["message"]);
        assert.ok(message.startsWith("🔖 hello-world-v${nextRelease.version}"), message);
        assert.ok(!message.includes("[skip ci]"), message);
        const prepareCmd = String(pluginOf(config, "@semantic-release/exec")?.["prepareCmd"]);
        assert.match(prepareCmd, /jq --arg v/, "the manifests are still synchronised");
        assert.ok(!prepareCmd.includes("release-package-extension"), prepareCmd);
        assert.ok(!prepareCmd.includes("--out"), prepareCmd);
      } finally {
        stub.stop();
        sb.dispose();
      }
    });

    it(`[${leg}] rb-g-release-branch-pushed: release-pr/main reaches origin and the PR is synced`, async () => {
      const sb = createReleaseSandbox();
      const stub = await startForgeStub();
      try {
        sb.scriptRehearse({
          "hello-world": { released: true, version: "9.0.0", gitTag: "hello-world-v9.0.0" },
          "second-ext": { released: false },
        });
        assert.deepEqual(originRefs(sb, "refs/heads/release-pr"), []);
        const res = sb.run(leg, { ...GITHUB_PUBLISH, GITHUB_API_URL: stub.apiUrl });
        assert.equal(res.status, 0, res.stdout + res.stderr);
        const lines = res.stdout.split("\n");
        assert.ok(lines.includes("RELEASE-PR-BRANCH release-pr/main"), res.stdout);
        assert.deepEqual(originRefs(sb, "refs/heads/release-pr"), ["refs/heads/release-pr/main"]);
        assert.ok(
          lines.some((l) => /^RELEASE-PR opened #1 /.test(l)),
          res.stdout,
        );
        assert.ok(
          lines.some((l) => /^RELEASE-PR-CHECKS dispatched .+ ref=release-pr\/main$/.test(l)),
          res.stdout,
        );
        // The release-PR sync is a fetch client of the forge API: the forge CLI is never run.
        assert.equal(sb.readJsonl("gh").length, 0);
        const calls = stub
          .requests()
          .map((r) => `${String(r["method"])} ${String(r["path"]).split("?")[0]}`);
        assert.deepEqual(calls, [
          "GET /repos/acme/fixture/pulls",
          "POST /repos/acme/fixture/pulls",
          calls[2] ?? "",
        ]);
        assert.match(
          calls[2] ?? "",
          /^POST \/repos\/acme\/fixture\/actions\/workflows\/.+\/dispatches$/,
        );
        const opened = stub.requests()[1]?.["body"] as Record<string, unknown>;
        assert.equal(opened["head"], "release-pr/main");
        assert.equal(opened["base"], "main");
      } finally {
        stub.stop();
        sb.dispose();
      }
    });

    it(`[${leg}] rb-g-sync-manifests-real: the pending version lands in both manifests of the release branch`, async () => {
      const sb = createReleaseSandbox({ extraExtensions: THREE });
      const stub = await startForgeStub();
      try {
        // third-ext has no extension.json: the sync tolerates the missing sibling.
        commitRemoval(sb, "extensions/core/third-ext/extension.json");
        sb.scriptRehearse({
          "hello-world": { released: false },
          "second-ext": {
            released: true,
            version: "0.6.0",
            gitTag: "second-ext-v0.6.0",
            prepare: true,
            commit: true,
          },
          "third-ext": {
            released: true,
            version: "0.7.0",
            gitTag: "third-ext-v0.7.0",
            prepare: true,
            commit: true,
          },
        });
        const res = sb.run(leg, { ...GITHUB_PUBLISH, GITHUB_API_URL: stub.apiUrl });
        assert.equal(res.status, 0, res.stdout + res.stderr);
        assert.ok(!res.stdout.includes("RELEASE-FAILED"), res.stdout);
        assert.equal(engineCalls(sb, "second-ext").filter((c) => c.apply).length, 1);
        const version = (file: string): unknown => {
          const text = showFromOrigin(sb, "release-pr/main", file);
          return text === null ? null : (JSON.parse(text) as { version: string }).version;
        };
        assert.equal(version("extensions/core/second-ext/package.json"), "0.6.0");
        assert.equal(version("extensions/core/second-ext/extension.json"), "0.6.0");
        assert.equal(version("extensions/core/third-ext/package.json"), "0.7.0");
        assert.equal(version("extensions/core/third-ext/extension.json"), null);
        // The unchanged extension keeps its committed version on the release branch.
        assert.equal(
          version("extensions/core/hello-world/package.json"),
          manifestVersion(sb, "hello-world"),
        );
      } finally {
        stub.stop();
        sb.dispose();
      }
    });

    it(`[${leg}] rb-g-semver-check: a rehearsal refuses a version that is not SemVer`, () => {
      const sb = createReleaseSandbox();
      try {
        sb.scriptRehearse({
          "hello-world": { released: true, version: "not-semver", gitTag: "hello-world-vnot" },
          "second-ext": { released: false },
        });
        const res = sb.run(leg, {
          GITHUB_ACTIONS: "true",
          RELEASE_DRY_RUN: "true",
          GITHUB_SERVER_URL: "https://github.com",
          GITHUB_REPOSITORY: "acme/fixture",
        });
        assert.equal(res.status, 1, res.stdout + res.stderr);
        assert.ok(res.stdout.split("\n").includes("RELEASE-FAILED hello-world step=engine"));
        assert.match(res.stderr, /Error: the engine computed a version that is not SemVer/);
        assert.ok(res.stdout.includes("Release analysis completed WITH ERRORS."));
        assert.ok(!/^REHEARSAL /m.test(res.stdout), "nothing is rehearsed for the refused version");
        assert.equal(sb.readJsonl("rehearse").length, 2);
        assert.equal(sb.readJsonl("npx").length, 0);
      } finally {
        sb.dispose();
      }
    });
  });
});

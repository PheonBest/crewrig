// monorepo-release-blackbox-config.test.ts — black-box cases (c) and (d) of spec 0257 requirement
// 22: the engine configuration and the git identity the release driver hands to `npx
// semantic-release` and to the rehearsal helper, captured by the stubs. Each case runs for every
// leg; only the exec `prepareCmd` is masked (deviation (b) of the spec: it changes in the port).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { REPO } from "./lib/build-fixture-tree.ts";
import {
  GITHUB_ENV,
  GITLAB_ENV,
  goldenForm,
  normalisePaths,
  npxConfig,
  pluginsNamed,
  recordedEnv,
  rehearseConfig,
  scriptHelloWorldPublish,
  withSandbox,
} from "./lib/release-blackbox-helpers.ts";
import type { Releaserc } from "./lib/release-blackbox-helpers.ts";
import { forEachLeg } from "./lib/release-blackbox-legs.ts";
import type { ReleaseSandbox } from "./lib/release-driver-sandbox.ts";

const GOLDEN = path.join(
  REPO,
  "scripts",
  "tests",
  "fixtures",
  "release-blackbox",
  "github-publish-releaserc.json.golden",
);
const IDENTITY = [
  "GIT_AUTHOR_NAME",
  "GIT_AUTHOR_EMAIL",
  "GIT_COMMITTER_NAME",
  "GIT_COMMITTER_EMAIL",
];
const BOT = "github-actions[bot]";
const BOT_EMAIL = "github-actions[bot]@users.noreply.github.com";
const PUBLISH_PLUGINS = ["@semantic-release/github", "@semantic-release/gitlab"];

/** GitHub publish where `hello-world` classifies as `publish`: one `npx` call, its config. */
function githubPublish(sb: ReleaseSandbox, leg: "shell" | "ts", extra = {}): Releaserc {
  scriptHelloWorldPublish(sb);
  const res = sb.run(leg, { ...GITHUB_ENV, GITHUB_TOKEN: "sentinel-gh", ...extra });
  assert.equal(sb.readJsonl("npx").length, 1, res.stdout + res.stderr);
  return npxConfig(sb, "hello-world");
}

/** GitLab publish: `npx` runs once per extension; the config of `hello-world`. */
function gitlabPublish(sb: ReleaseSandbox, leg: "shell" | "ts", extra = {}): Releaserc {
  const res = sb.run(leg, { ...GITLAB_ENV, GITLAB_TOKEN: "sentinel-gl", ...extra });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.equal(sb.readJsonl("npx").length, 2);
  return npxConfig(sb, "hello-world");
}

/** A rehearsal on `env`'s forge: the helper is called once per extension. */
function rehearsal(
  sb: ReleaseSandbox,
  leg: "shell" | "ts",
  env: Record<string, string>,
): Releaserc {
  const res = sb.run(leg, { ...env, RELEASE_DRY_RUN: "true" });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.equal(sb.readJsonl("rehearse").length, 2);
  return rehearseConfig(sb, "hello-world");
}

function prepareCmd(config: Releaserc): unknown {
  return pluginsNamed(config, "@semantic-release/exec")[0]?.[1]["prepareCmd"];
}

describe("release driver black box: (c) GitHub publish configuration and identity", () => {
  forEachLeg((leg) => {
    it(`rb-c-github-publish-golden [${leg}]`, () => {
      withSandbox((sb) => {
        const golden = fs.readFileSync(GOLDEN, "utf8");
        assert.ok(golden.startsWith("{") && golden.length > 200, "the golden is real content");
        const config = githubPublish(sb, leg);
        assert.equal(typeof prepareCmd(config), "string", "the exec step is present");
        assert.equal(goldenForm(config, sb), golden);
      });
    });

    it(`rb-c-identity-defaults [${leg}]`, () => {
      withSandbox((sb) => {
        githubPublish(sb, leg);
        const env = recordedEnv(sb, "npx", 0);
        assert.equal(env["GIT_AUTHOR_NAME"], BOT);
        assert.equal(env["GIT_COMMITTER_NAME"], BOT);
        assert.equal(env["GIT_AUTHOR_EMAIL"], BOT_EMAIL);
        assert.equal(env["GIT_COMMITTER_EMAIL"], BOT_EMAIL);
      });
    });

    it(`rb-c-identity-override [${leg}]`, () => {
      withSandbox((sb) => {
        githubPublish(sb, leg, { GIT_AUTHOR_NAME: "custom-name", GIT_COMMITTER_EMAIL: "c@x.test" });
        const env = recordedEnv(sb, "npx", 0);
        assert.equal(env["GIT_AUTHOR_NAME"], "custom-name");
        assert.equal(env["GIT_COMMITTER_EMAIL"], "c@x.test");
        assert.equal(env["GIT_AUTHOR_EMAIL"], BOT_EMAIL, "an unset value still defaults");
        assert.equal(env["GIT_COMMITTER_NAME"], BOT);
      });
    });

    it(`rb-c-identity-gitlab-sets-nothing [${leg}]`, () => {
      withSandbox((sb) => {
        gitlabPublish(sb, leg);
        for (const index of [0, 1]) {
          const env = recordedEnv(sb, "npx", index);
          for (const name of IDENTITY) assert.equal(env[name], undefined, name);
        }
      });
    });
  });
});

describe("release driver black box: (d) structure per forge and mode", () => {
  forEachLeg((leg) => {
    it(`rb-d-publish-diff-only-legs [${leg}]`, () => {
      let github: Releaserc | undefined;
      let gitlab: Releaserc | undefined;
      // Two sandboxes have two roots: the command is compared with the root as a placeholder.
      const commands: string[] = [];
      withSandbox((sb) => {
        github = githubPublish(sb, leg);
        commands.push(normalisePaths(String(prepareCmd(github)), sb));
      });
      withSandbox((sb) => {
        gitlab = gitlabPublish(sb, leg);
        commands.push(normalisePaths(String(prepareCmd(gitlab)), sb));
      });
      assert.ok(github !== undefined && gitlab !== undefined);
      assert.equal(github.extends, gitlab.extends);
      assert.deepEqual(github.branches, gitlab.branches);
      assert.equal(github.tagFormat, gitlab.tagFormat);
      const rules = (c: Releaserc): unknown =>
        (c.plugins[0] as [string, { releaseRules: unknown }])[1].releaseRules;
      assert.deepEqual(rules(github), rules(gitlab));
      assert.notEqual(rules(github), undefined);
      assert.ok(commands[0] !== undefined && commands[0].includes("<ROOT>"), "a command was read");
      assert.equal(commands[0], commands[1]);

      const notes = (c: Releaserc): boolean =>
        "releaseNotes" in (c.plugins[0] as [string, Record<string, unknown>])[1];
      assert.deepEqual([notes(github), notes(gitlab)], [false, true]);
      assert.deepEqual(["repositoryUrl" in github, "repositoryUrl" in gitlab], [false, true]);

      // The GitLab publish keeps its direct release commit and its `[skip ci]` token.
      const gitStep = pluginsNamed(gitlab, "@semantic-release/git");
      assert.equal(gitStep.length, 1);
      assert.match(String(gitStep[0]?.[1]["message"]), /\[skip ci\]/);
    });

    it(`rb-d-gitlab-one-asset [${leg}]`, () => {
      withSandbox((sb) => {
        const config = gitlabPublish(sb, leg);
        const entries = pluginsNamed(config, "@semantic-release/gitlab");
        assert.equal(entries.length, 1);
        const assets = entries[0]?.[1]["assets"] as Record<string, unknown>[];
        assert.equal(assets.length, 1);
        assert.equal(assets[0]?.["target"], "generic_package");
        assert.equal("label" in (assets[0] ?? {}), false);
        assert.match(String(assets[0]?.["path"]), /\*\.tar\.gz$/);
      });
    });

    it(`rb-d-rehearsal-no-publish-leg [${leg}]`, () => {
      for (const env of [GITHUB_ENV, GITLAB_ENV]) {
        withSandbox((sb) => {
          const config = rehearsal(sb, leg, env);
          assert.ok(config.plugins.length > 0, "the captured configuration is not empty");
          for (const name of PUBLISH_PLUGINS) {
            assert.equal(pluginsNamed(config, name).length, 0, name);
          }
        });
      }
    });
  });
});

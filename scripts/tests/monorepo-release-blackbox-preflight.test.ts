// monorepo-release-blackbox-preflight.test.ts — black-box cases (a), (b) and (e) of spec 0257
// requirement 22: the release driver's refusals, its mode matrix and its credential handling,
// seen only through its exit status, its output and what the capturing stubs recorded. Each case
// runs for every leg, so the shell driver and the TypeScript one are held to the same assertions.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { forEachLeg } from "./lib/release-blackbox-legs.ts";
import {
  FORGE_ENV,
  GITHUB_ENV,
  GITLAB_ENV,
  findNamed,
  recordedEnv,
  scriptHelloWorldPublish,
  withSandbox,
} from "./lib/release-blackbox-helpers.ts";
import type { ReleaseSandbox } from "./lib/release-driver-sandbox.ts";
import { isCredentialName } from "./lib/release-capture-stubs.ts";

const BRANCH_REFUSAL =
  "Error: not a branch pipeline (merge-request or tag): run the release from a branch pipeline";

/** No engine was started and no configuration was written anywhere under the sandbox. */
function assertNothingRan(sb: ReleaseSandbox): void {
  assert.deepEqual(sb.readJsonl("npx"), []);
  assert.deepEqual(sb.readJsonl("rehearse"), []);
  assert.deepEqual(findNamed(sb.root, ".releaserc.json"), []);
}

function assertRefused(
  sb: ReleaseSandbox,
  res: { status: number | null; stderr: string },
  message: string,
): void {
  assert.equal(res.status, 2, res.stderr);
  assert.ok(res.stderr.includes(message), `stderr must contain "${message}", got: ${res.stderr}`);
  assertNothingRan(sb);
}

describe("release driver black box: (a) forge refusals", () => {
  const cases: readonly [string, Record<string, string>, string][] = [
    ["rb-a-gitea", { GITEA_ACTIONS: "true" }, "unsupported release forge: gitea"],
    [
      "rb-a-ambiguous",
      { GITHUB_ACTIONS: "true", GITLAB_CI: "true" },
      "unsupported release forge: ambiguous (github+gitlab)",
    ],
    ["rb-a-none", {}, "unsupported release forge: none (not a CI environment)"],
    ["rb-a-unknown-ci", { CI: "true" }, "unsupported release forge: unknown CI"],
  ];
  for (const [name, env, reason] of cases) {
    forEachLeg((leg) => {
      it(`${name} [${leg}]`, () => {
        withSandbox((sb) => {
          assert.deepEqual(findNamed(sb.root, ".releaserc.json"), [], "the walk starts clean");
          assertRefused(sb, sb.run(leg, env), `Error: ${reason}`);
        });
      });
    });
  }
});

describe("release driver black box: (b) mode matrix and GitLab branch refusals", () => {
  /** A rehearsal reaches the rehearsal helper once per extension and never `npx`. */
  function assertRehearsal(sb: ReleaseSandbox, stdout: string): void {
    assert.match(stdout, /^Mode: rehearsal$/m);
    assert.equal(sb.readJsonl("rehearse").length, 2);
    assert.deepEqual(sb.readJsonl("npx"), []);
  }
  /** A GitLab publish runs `npx semantic-release` once per extension and never the helper. */
  function assertGitlabPublish(sb: ReleaseSandbox, stdout: string): void {
    assert.match(stdout, /^Mode: publish$/m);
    assert.equal(sb.readJsonl("npx").length, 2);
    assert.deepEqual(sb.readJsonl("rehearse"), []);
  }
  const gitlabPublish = { ...GITLAB_ENV, GITLAB_TOKEN: "sentinel-publish" };

  forEachLeg((leg) => {
    it(`rb-b-canonical [${leg}]`, () => {
      withSandbox((sb) => {
        const res = sb.run(leg, { ...GITHUB_ENV, RELEASE_DRY_RUN: "true" });
        assert.equal(res.status, 0, res.stdout + res.stderr);
        assertRehearsal(sb, res.stdout);
      });
      for (const extra of [{}, { RELEASE_DRY_RUN: "false", DRY_RUN: "false" }]) {
        withSandbox((sb) => {
          const res = sb.run(leg, { ...gitlabPublish, ...extra });
          assert.equal(res.status, 0, res.stdout + res.stderr);
          assertGitlabPublish(sb, res.stdout);
        });
      }
    });

    it(`rb-b-alias [${leg}]`, () => {
      withSandbox((sb) => {
        const res = sb.run(leg, { ...GITHUB_ENV, DRY_RUN: "true" });
        assert.equal(res.status, 0, res.stdout + res.stderr);
        assertRehearsal(sb, res.stdout);
      });
    });

    it(`rb-b-conflict-true-wins [${leg}]`, () => {
      for (const conflict of [
        { RELEASE_DRY_RUN: "false", DRY_RUN: "true" },
        { RELEASE_DRY_RUN: "true", DRY_RUN: "false" },
      ]) {
        withSandbox((sb) => {
          const res = sb.run(leg, { ...GITHUB_ENV, ...conflict });
          assert.equal(res.status, 0, res.stdout + res.stderr);
          assertRehearsal(sb, res.stdout);
        });
      }
    });

    it(`rb-b-invalid [${leg}]`, () => {
      const invalid: readonly [Record<string, string>, string][] = [
        [
          { RELEASE_DRY_RUN: "maybe" },
          "Error: invalid RELEASE_DRY_RUN value (expected true, false or empty)",
        ],
        [{ DRY_RUN: "1" }, "Error: invalid DRY_RUN value (expected true, false or empty)"],
      ];
      for (const [env, message] of invalid) {
        withSandbox((sb) => assertRefused(sb, sb.run(leg, { ...GITHUB_ENV, ...env }), message));
      }
    });

    it(`rb-b-gitlab-mr [${leg}]`, () => {
      withSandbox((sb) => {
        const env = { ...GITLAB_ENV, CI_PIPELINE_SOURCE: "merge_request_event" };
        assertRefused(sb, sb.run(leg, env), BRANCH_REFUSAL);
      });
    });

    it(`rb-b-gitlab-tag [${leg}]`, () => {
      withSandbox((sb) => {
        assertRefused(sb, sb.run(leg, { ...GITLAB_ENV, CI_COMMIT_BRANCH: "" }), BRANCH_REFUSAL);
      });
    });
  });
});

describe("release driver black box: (e) credentials", () => {
  const SENTINELS: Record<string, string> = {};
  for (const name of [
    "GITHUB_TOKEN",
    "GH_TOKEN",
    "GITLAB_TOKEN",
    "GL_TOKEN",
    "RELEASE_TOKEN",
    "CI_REPOSITORY_URL",
    "some_password",
    "A_SECRET_KEY",
    "private_key",
    "MY_CREDENTIALS",
    "my_secret",
  ]) {
    SENTINELS[name] = `sentinel-${name}-9f3a`;
  }

  forEachLeg((leg) => {
    it(`rb-e-strip [${leg}]`, () => {
      withSandbox((sb) => {
        // The table is only meaningful when every name is one the release core masks.
        for (const name of Object.keys(SENTINELS)) assert.ok(isCredentialName(name), name);
        const res = sb.run(leg, { ...GITHUB_ENV, RELEASE_DRY_RUN: "true", ...SENTINELS });
        const all = res.stdout + res.stderr;
        assert.equal(res.status, 0, all);
        assert.doesNotMatch(all, /RELEASE-FAILED/);
        assert.equal(sb.readJsonl("rehearse").length, 2, "both helper calls were reached");
        for (const index of [0, 1]) {
          const env = recordedEnv(sb, "rehearse", index);
          assert.equal(env["GITHUB_REPOSITORY"], GITHUB_ENV.GITHUB_REPOSITORY, "the env is read");
          assert.deepEqual(Object.keys(env).filter(isCredentialName), []);
        }
        for (const value of Object.values(SENTINELS)) assert.ok(!all.includes(value), value);
      });
    });

    it(`rb-e-publish-credential [${leg}]`, () => {
      withSandbox((sb) => {
        scriptHelloWorldPublish(sb);
        const token = "sentinel-release-token-4c1d";
        const res = sb.run(leg, { ...GITHUB_ENV, RELEASE_TOKEN: token });
        const all = res.stdout + res.stderr;
        assert.equal(sb.readJsonl("npx").length, 1, all);
        assert.equal(recordedEnv(sb, "npx", 0)["GITHUB_TOKEN"], token);
        assert.ok(!all.includes(token), "the credential value is never printed");
        // The classification run is credential-free: the helper never sees the token.
        const calls = sb.readJsonl("rehearse");
        assert.equal(calls.length, 2);
        for (const index of [0, 1]) {
          assert.deepEqual(
            Object.keys(recordedEnv(sb, "rehearse", index)).filter(isCredentialName),
            [],
          );
        }
      });
    });

    it(`rb-e-missing-credential [${leg}]`, () => {
      const cases: readonly [Record<string, string>, string][] = [
        [GITHUB_ENV, "Error: no release credential: set GITHUB_TOKEN (or RELEASE_TOKEN)"],
        [
          { ...GITHUB_ENV, GITHUB_TOKEN: "$GITHUB_TOKEN" },
          "Error: no release credential: set GITHUB_TOKEN (or RELEASE_TOKEN)",
        ],
        [
          GITLAB_ENV,
          "Error: no release credential: set the masked CI/CD variable GITLAB_TOKEN (or RELEASE_TOKEN)",
        ],
      ];
      for (const [env, message] of cases) {
        withSandbox((sb) => assertRefused(sb, sb.run(leg, env), message));
      }
      assert.ok(FORGE_ENV.github !== FORGE_ENV.gitlab);
    });
  });
});

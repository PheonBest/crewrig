// Spec 0257 R13: the driver's `main`, preflight refusals and their order, exit status 2.

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

describe("main preflight refusals", () => {
  const rows: Array<[string, Env, string]> = [
    ["no CI", {}, "unsupported release forge: none (not a CI environment)"],
    ["gitea", { GITEA_ACTIONS: "true" }, "unsupported release forge: gitea"],
    [
      "ambiguous forge",
      { GITHUB_ACTIONS: "true", GITLAB_CI: "true" },
      "unsupported release forge: ambiguous (github+gitlab)",
    ],
    [
      "forge is checked before the mode",
      { RELEASE_DRY_RUN: "maybe" },
      "unsupported release forge: none (not a CI environment)",
    ],
    [
      "invalid mode",
      { ...GITLAB, RELEASE_DRY_RUN: "maybe" },
      "invalid RELEASE_DRY_RUN value (expected true, false or empty)",
    ],
    [
      "invalid alias",
      { ...GITLAB, DRY_RUN: "1" },
      "invalid DRY_RUN value (expected true, false or empty)",
    ],
    [
      "gitlab merge-request pipeline",
      { ...GITLAB, CI_PIPELINE_SOURCE: "merge_request_event" },
      "not a branch pipeline (merge-request or tag): run the release from a branch pipeline",
    ],
    [
      "the branch is checked before the forge variables",
      { GITLAB_CI: "true", CI_COMMIT_BRANCH: "" },
      "not a branch pipeline (merge-request or tag): run the release from a branch pipeline",
    ],
    ["gitlab CI_PROJECT_URL", { ...GITLAB, CI_PROJECT_URL: "" }, "CI_PROJECT_URL is not set"],
    ["gitlab CI_SERVER_URL", { ...GITLAB, CI_SERVER_URL: "" }, "CI_SERVER_URL is not set"],
    [
      "the variables are checked before the credential",
      { ...GITLAB, CI_SERVER_URL: "", GITLAB_TOKEN: "" },
      "CI_SERVER_URL is not set",
    ],
    [
      "gitlab credential",
      { ...GITLAB, GITLAB_TOKEN: "" },
      "no release credential: set the masked CI/CD variable GITLAB_TOKEN (or RELEASE_TOKEN)",
    ],
    [
      "an unexpanded credential reference",
      { ...GITLAB, GITLAB_TOKEN: "$GITLAB_TOKEN" },
      "no release credential: set the masked CI/CD variable GITLAB_TOKEN (or RELEASE_TOKEN)",
    ],
  ];
  for (const [name, env, message] of rows) {
    it(`exits 2 with the exact message: ${name}`, async () => {
      const result = await run(env);
      assert.equal(result.code, 2);
      assert.deepEqual(result.err, [`Error: ${message}`]);
      assert.deepEqual(result.out, []);
    });
  }

  it("github: the forge variables, then the release PR branch, then the credential", async () => {
    initRepo("release-pr/main");
    const { GITHUB_SERVER_URL: _omitted, ...withoutUrl } = GITHUB;
    assert.deepEqual((await run({ ...withoutUrl, GITHUB_TOKEN: "" })).err, [
      "Error: GITHUB_SERVER_URL is not set",
    ]);
    assert.deepEqual((await run({ ...GITHUB, GITHUB_REPOSITORY: "" })).err, [
      "Error: GITHUB_REPOSITORY is not set",
    ]);
    const refused = await run({ ...GITHUB, GITHUB_TOKEN: "" });
    assert.equal(refused.code, 2);
    assert.deepEqual(refused.err, [
      "Error: refusing to publish from a release PR branch (release-pr/main): merge the release PR instead",
    ]);
  });

  it("github: a rehearsal on the release PR branch is allowed and needs no credential", async () => {
    initRepo("release-pr/main");
    const result = await run({ ...GITHUB, GITHUB_TOKEN: "", RELEASE_DRY_RUN: "true" });
    assert.equal(result.code, 0);
  });

  it("github: no release credential", async () => {
    initRepo("main");
    const result = await run({ ...GITHUB, GITHUB_TOKEN: "" });
    assert.equal(result.code, 2);
    assert.deepEqual(result.err, [
      "Error: no release credential: set GITHUB_TOKEN (or RELEASE_TOKEN)",
    ]);
  });
});

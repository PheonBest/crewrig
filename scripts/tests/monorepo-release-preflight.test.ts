// monorepo-release-preflight.test.ts — forge, mode, branch and identity preflight of the monorepo release driver
// (spec 0257 R13). Every refusal is a thrown ReleaseRefusal carrying the shell's exact message.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  assertNotReleasePrBranch,
  releaseBranch,
  releasePrBranch,
} from "../lib/monorepo-release/branch.ts";
import { detectForge, forgeUrl, requireForgeVariables } from "../lib/monorepo-release/forge.ts";
import { applyIdentity } from "../lib/monorepo-release/identity.ts";
import { releaseMode } from "../lib/monorepo-release/mode.ts";
import { refusal } from "./lib/release-preflight-tables.ts";

describe("detectForge", () => {
  const rows: Array<[string, NodeJS.ProcessEnv, string]> = [
    [
      "gitea wins over github",
      { GITEA_ACTIONS: "true", GITHUB_ACTIONS: "true" },
      "unsupported release forge: gitea",
    ],
    ["gitea alone", { GITEA_ACTIONS: "true" }, "unsupported release forge: gitea"],
    [
      "both forges",
      { GITHUB_ACTIONS: "true", GITLAB_CI: "true" },
      "unsupported release forge: ambiguous (github+gitlab)",
    ],
    ["unknown CI", { CI: "true" }, "unsupported release forge: unknown CI"],
    ["no CI", {}, "unsupported release forge: none (not a CI environment)"],
    [
      "non-true values are not CI",
      { GITHUB_ACTIONS: "1", CI: "1" },
      "unsupported release forge: none (not a CI environment)",
    ],
  ];
  for (const [name, env, message] of rows) {
    test(`refuses: ${name}`, () => {
      assert.throws(() => detectForge(env), refusal(message));
    });
  }

  test("github", () => assert.equal(detectForge({ GITHUB_ACTIONS: "true", CI: "true" }), "github"));
  test("gitlab", () => assert.equal(detectForge({ GITLAB_CI: "true", CI: "true" }), "gitlab"));
  test("GITEA_ACTIONS=false does not trigger the gitea refusal", () => {
    assert.equal(detectForge({ GITEA_ACTIONS: "false", GITHUB_ACTIONS: "true" }), "github");
  });
});

describe("requireForgeVariables and forgeUrl", () => {
  test("gitlab refuses CI_PROJECT_URL first, then CI_SERVER_URL", () => {
    assert.throws(() => requireForgeVariables("gitlab", {}), refusal("CI_PROJECT_URL is not set"));
    assert.throws(
      () => requireForgeVariables("gitlab", { CI_PROJECT_URL: "https://x/p", CI_SERVER_URL: "" }),
      refusal("CI_SERVER_URL is not set"),
    );
  });
  test("github refuses GITHUB_SERVER_URL first, then GITHUB_REPOSITORY", () => {
    assert.throws(
      () => requireForgeVariables("github", {}),
      refusal("GITHUB_SERVER_URL is not set"),
    );
    assert.throws(
      () => requireForgeVariables("github", { GITHUB_SERVER_URL: "https://github.com" }),
      refusal("GITHUB_REPOSITORY is not set"),
    );
  });
  test("the other forge's variables do not satisfy the check", () => {
    assert.throws(
      () => requireForgeVariables("gitlab", { GITHUB_SERVER_URL: "a", GITHUB_REPOSITORY: "b" }),
      refusal("CI_PROJECT_URL is not set"),
    );
  });
  test("accepts complete variables and builds the clone URLs", () => {
    const github = { GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "o/r" };
    const gitlab = {
      CI_PROJECT_URL: "https://gl.example/g/p",
      CI_SERVER_URL: "https://gl.example",
    };
    requireForgeVariables("github", github);
    requireForgeVariables("gitlab", gitlab);
    assert.equal(forgeUrl("github", github), "https://github.com/o/r.git");
    assert.equal(forgeUrl("gitlab", gitlab), "https://gl.example/g/p.git");
  });
});

describe("releaseMode", () => {
  const rows: Array<[string, NodeJS.ProcessEnv, string]> = [
    ["nothing set", {}, "publish"],
    ["both empty", { RELEASE_DRY_RUN: "", DRY_RUN: "" }, "publish"],
    ["canonical true", { RELEASE_DRY_RUN: "true" }, "rehearsal"],
    ["alias true", { DRY_RUN: "true" }, "rehearsal"],
    ["canonical false", { RELEASE_DRY_RUN: "false" }, "publish"],
    ["alias false", { DRY_RUN: "false" }, "publish"],
    ["conflict: true wins (alias)", { RELEASE_DRY_RUN: "false", DRY_RUN: "true" }, "rehearsal"],
    ["conflict: true wins (canonical)", { RELEASE_DRY_RUN: "true", DRY_RUN: "false" }, "rehearsal"],
  ];
  for (const [name, env, mode] of rows) {
    test(name, () => assert.equal(releaseMode(env), mode));
  }

  test("invalid RELEASE_DRY_RUN", () => {
    for (const value of ["1", "TRUE", "yes", " true"]) {
      assert.throws(
        () => releaseMode({ RELEASE_DRY_RUN: value }),
        refusal("invalid RELEASE_DRY_RUN value (expected true, false or empty)"),
      );
    }
  });
  test("invalid DRY_RUN", () => {
    assert.throws(
      () => releaseMode({ DRY_RUN: "maybe" }),
      refusal("invalid DRY_RUN value (expected true, false or empty)"),
    );
  });
  test("RELEASE_DRY_RUN is validated before DRY_RUN", () => {
    assert.throws(
      () => releaseMode({ RELEASE_DRY_RUN: "x", DRY_RUN: "y" }),
      refusal("invalid RELEASE_DRY_RUN value (expected true, false or empty)"),
    );
  });
});

describe("releaseBranch", () => {
  const notBranch =
    "not a branch pipeline (merge-request or tag): run the release from a branch pipeline";
  test("github uses the injected git result and ignores CI_COMMIT_BRANCH", () => {
    assert.equal(
      releaseBranch("github", { CI_COMMIT_BRANCH: "other" }, () => "main"),
      "main",
    );
  });
  test("gitlab uses CI_COMMIT_BRANCH and never calls git", () => {
    const branch = releaseBranch("gitlab", { CI_COMMIT_BRANCH: "main" }, () => {
      throw new Error("git must not run");
    });
    assert.equal(branch, "main");
  });
  test("gitlab refuses a merge-request pipeline even with a branch set", () => {
    assert.throws(
      () =>
        releaseBranch(
          "gitlab",
          { CI_PIPELINE_SOURCE: "merge_request_event", CI_COMMIT_BRANCH: "x" },
          () => "",
        ),
      refusal(notBranch),
    );
  });
  test("gitlab refuses a tag pipeline (empty or unset CI_COMMIT_BRANCH)", () => {
    assert.throws(() => releaseBranch("gitlab", {}, () => ""), refusal(notBranch));
    assert.throws(
      () => releaseBranch("gitlab", { CI_COMMIT_BRANCH: "" }, () => ""),
      refusal(notBranch),
    );
  });
});

describe("release PR branch", () => {
  test("releasePrBranch", () => assert.equal(releasePrBranch("main"), "release-pr/main"));
  test("refuses a github release-pr branch with the exact message", () => {
    assert.throws(
      () => assertNotReleasePrBranch("github", "release-pr/main"),
      refusal(
        "refusing to publish from a release PR branch (release-pr/main): merge the release PR instead",
      ),
    );
  });
  test("accepts other branches and the gitlab forge", () => {
    assertNotReleasePrBranch("github", "main");
    assertNotReleasePrBranch("github", "release/1.x");
    assertNotReleasePrBranch("gitlab", "release-pr/main");
  });
});

describe("applyIdentity", () => {
  const bot = "github-actions[bot]";
  const email = "github-actions[bot]@users.noreply.github.com";
  test("github defaults the four variables", () => {
    assert.deepEqual(applyIdentity("github", {}), {
      GIT_AUTHOR_NAME: bot,
      GIT_AUTHOR_EMAIL: email,
      GIT_COMMITTER_NAME: bot,
      GIT_COMMITTER_EMAIL: email,
    });
  });
  test("github never overrides a value already set, but fills an empty one", () => {
    const out = applyIdentity("github", { GIT_AUTHOR_NAME: "Ada", GIT_COMMITTER_EMAIL: "" });
    assert.equal(out["GIT_AUTHOR_NAME"], "Ada");
    assert.equal(out["GIT_COMMITTER_EMAIL"], email);
    assert.equal(out["GIT_AUTHOR_EMAIL"], email);
  });
  test("gitlab sets nothing and the input is not mutated", () => {
    const env = { GIT_AUTHOR_NAME: "Ada" };
    assert.deepEqual(applyIdentity("gitlab", env), {});
    assert.deepEqual(applyIdentity("github", env).GIT_AUTHOR_NAME, "Ada");
    assert.deepEqual(env, { GIT_AUTHOR_NAME: "Ada" });
  });
});

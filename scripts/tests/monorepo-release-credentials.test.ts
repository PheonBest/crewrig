// monorepo-release-credentials.test.ts — the credential-name rule, stripping and resolution of the monorepo release driver
// (spec 0257 R18). A credential value must never appear in a refusal message.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  credentialHelperOverrides,
  isCredentialName,
  resolveCredential,
  stripCredentials,
  tokenUsable,
} from "../lib/monorepo-release/credentials.ts";
import { ReleaseRefusal } from "../lib/monorepo-release/refusal.ts";
import { CREDENTIAL_NAMES, refusal } from "./lib/release-preflight-tables.ts";

describe("isCredentialName", () => {
  for (const [name, expected] of CREDENTIAL_NAMES) {
    test(`${JSON.stringify(name)} -> ${String(expected)}`, () => {
      assert.equal(isCredentialName(name), expected);
    });
  }
});

describe("stripCredentials", () => {
  test("drops credential-named keys and keeps the rest", () => {
    const env = {
      PATH: "/bin",
      GITHUB_TOKEN: "ghs_secretvalue",
      CI_REPOSITORY_URL: "https://gitlab-ci-token:abc@host/p.git",
      GIT_AUTHOR_NAME: "Ada",
      empty: undefined,
    };
    const out = stripCredentials(env);
    assert.deepEqual(Object.keys(out).sort(), ["GIT_AUTHOR_NAME", "PATH", "empty"]);
    assert.equal(out["PATH"], "/bin");
    assert.equal(env.GITHUB_TOKEN, "ghs_secretvalue");
  });
});

describe("tokenUsable", () => {
  test("table", () => {
    assert.equal(tokenUsable(undefined), false);
    assert.equal(tokenUsable(""), false);
    assert.equal(tokenUsable("$GITHUB_TOKEN"), false);
    assert.equal(tokenUsable("$"), false);
    assert.equal(tokenUsable("ghs_x"), true);
    assert.equal(tokenUsable("a$b"), true);
  });
});

describe("resolveCredential", () => {
  const SECRET = "s3cr3t-value-123";
  test("github: own variables win and nothing is exported", () => {
    assert.deepEqual(resolveCredential("github", { GITHUB_TOKEN: "a", RELEASE_TOKEN: SECRET }), {});
    assert.deepEqual(resolveCredential("github", { GH_TOKEN: "a", RELEASE_TOKEN: SECRET }), {});
  });
  test("github: RELEASE_TOKEN fills in when the own variables are unusable", () => {
    assert.deepEqual(resolveCredential("github", { RELEASE_TOKEN: SECRET }), {
      GITHUB_TOKEN: SECRET,
    });
    assert.deepEqual(
      resolveCredential("github", {
        GITHUB_TOKEN: "$GITHUB_TOKEN",
        GH_TOKEN: "",
        RELEASE_TOKEN: SECRET,
      }),
      { GITHUB_TOKEN: SECRET },
    );
  });
  test("gitlab mirrors github with GITLAB_TOKEN and GL_TOKEN", () => {
    assert.deepEqual(resolveCredential("gitlab", { GL_TOKEN: "a" }), {});
    assert.deepEqual(resolveCredential("gitlab", { RELEASE_TOKEN: SECRET }), {
      GITLAB_TOKEN: SECRET,
    });
    assert.deepEqual(resolveCredential("gitlab", { GITHUB_TOKEN: "a", RELEASE_TOKEN: SECRET }), {
      GITLAB_TOKEN: SECRET,
    });
  });
  test("github refusal text", () => {
    assert.throws(
      () => resolveCredential("github", {}),
      refusal("no release credential: set GITHUB_TOKEN (or RELEASE_TOKEN)"),
    );
  });
  test("gitlab refusal text", () => {
    assert.throws(
      () => resolveCredential("gitlab", {}),
      refusal(
        "no release credential: set the masked CI/CD variable GITLAB_TOKEN (or RELEASE_TOKEN)",
      ),
    );
  });
  test("a refusal never contains an unusable credential value", () => {
    const placeholder = "$UNEXPANDED_SECRET_NAME";
    for (const forge of ["github", "gitlab"] as const) {
      try {
        resolveCredential(forge, {
          GITHUB_TOKEN: placeholder,
          GITLAB_TOKEN: placeholder,
          RELEASE_TOKEN: placeholder,
        });
        assert.fail("expected a refusal");
      } catch (error) {
        assert.ok(error instanceof ReleaseRefusal);
        assert.ok(!error.message.includes(placeholder));
      }
    }
  });
});

describe("credentialHelperOverrides", () => {
  test("starts at index 0 when GIT_CONFIG_COUNT is unset", () => {
    assert.deepEqual(credentialHelperOverrides({}), {
      GIT_CONFIG_KEY_0: "credential.helper",
      GIT_CONFIG_VALUE_0: "",
      GIT_CONFIG_COUNT: "1",
    });
  });
  test("appends after a preset count", () => {
    assert.deepEqual(credentialHelperOverrides({ GIT_CONFIG_COUNT: "2" }), {
      GIT_CONFIG_KEY_2: "credential.helper",
      GIT_CONFIG_VALUE_2: "",
      GIT_CONFIG_COUNT: "3",
    });
  });
  test("an invalid or empty count restarts at 0", () => {
    for (const value of ["", "abc", "-1", "1.5", "2x"]) {
      const out = credentialHelperOverrides({ GIT_CONFIG_COUNT: value });
      assert.equal(out["GIT_CONFIG_COUNT"], "1");
      assert.equal(out["GIT_CONFIG_KEY_0"], "credential.helper");
    }
  });
});

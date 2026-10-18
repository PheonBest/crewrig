// monorepo-release-log-parse.test.ts — classify, engine-log parsing and SemVer shape of the monorepo release driver
// (spec 0257 R13). Table-driven.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { classify } from "../lib/monorepo-release/classify.ts";
import { createdTag, failedStep, isSemver } from "../lib/monorepo-release/log-parse.ts";
import { FAILED_LOGS, SEMVER_TABLE, TAG_LOGS } from "./lib/release-preflight-tables.ts";

describe("classify", () => {
  const rows: Array<[string, string, string, string]> = [
    ["false", "1.2.0", "1.1.0", "unchanged"],
    ["", "", "", "unchanged"],
    ["false", "1.2.0", "1.2.0", "unchanged"],
    ["true", "1.2.0", "1.2.0", "publish"],
    ["true", "1.2.0", "1.1.0", "pending"],
    ["true", "1.2.0", "", "pending"],
    ["True", "1.2.0", "1.2.0", "unchanged"],
  ];
  for (const [released, next, manifest, expected] of rows) {
    test(`${JSON.stringify([released, next, manifest])} -> ${expected}`, () => {
      assert.equal(classify(released, next, manifest), expected);
    });
  }
});

describe("failedStep", () => {
  for (const [name, log, expected] of FAILED_LOGS) {
    test(name, () => assert.equal(failedStep(log), expected));
  }
});

describe("createdTag", () => {
  for (const [name, log, expected] of TAG_LOGS) {
    test(name, () => assert.equal(createdTag(log), expected));
  }
});

describe("isSemver", () => {
  for (const [version, expected] of SEMVER_TABLE) {
    test(`${JSON.stringify(version)} -> ${String(expected)}`, () => {
      assert.equal(isSemver(version), expected);
    });
  }
});

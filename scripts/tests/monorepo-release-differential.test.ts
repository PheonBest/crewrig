// monorepo-release-differential.test.ts — the preflight modules against the real shell library
// (spec 0257 R13, R18). scripts/lib/monorepo-release-lib.sh is the oracle: the same tables must agree. Skipped without bash.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { classify } from "../lib/monorepo-release/classify.ts";
import { isCredentialName } from "../lib/monorepo-release/credentials.ts";
import { createdTag, failedStep, isSemver } from "../lib/monorepo-release/log-parse.ts";
import {
  CREDENTIAL_NAMES,
  FAILED_LOGS,
  SEMVER_TABLE,
  TAG_LOGS,
} from "./lib/release-preflight-tables.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LIB = path.join(REPO, "scripts", "lib", "monorepo-release-lib.sh");

const bash = spawnSync("bash", ["--version"], { encoding: "utf8" });
const HAVE_BASH = bash.status === 0;

function shell(body: string, ...args: string[]): { status: number | null; stdout: string } {
  const env = { ...process.env };
  delete env["NODE_TEST_CONTEXT"];
  const res = spawnSync("bash", ["-c", `. "$LIB"; ${body}`, "oracle", ...args], {
    encoding: "utf8",
    env: { ...env, LIB },
  });
  return { status: res.status, stdout: res.stdout };
}

const logDir = mkdtempSync(path.join(tmpdir(), "release-preflight-"));
let logCount = 0;

/** The shell library reads a log FILE; write the table's text verbatim, byte for byte. */
function logFile(text: string): string {
  logCount += 1;
  const file = path.join(logDir, `log-${logCount}.txt`);
  writeFileSync(file, text);
  return file;
}

describe("differential against monorepo-release-lib.sh", { skip: !HAVE_BASH }, () => {
  test("release_classify", () => {
    for (const [released, next, manifest] of [
      ["false", "1", "1"],
      ["true", "1", "1"],
      ["true", "1", "2"],
      ["", "", ""],
      ["True", "1", "1"],
    ] as const) {
      assert.equal(
        shell('release_classify "$1" "$2" "$3"', released, next, manifest).stdout.trim(),
        classify(released, next, manifest),
      );
    }
  });
  test("release_is_semver", () => {
    for (const [version, expected] of SEMVER_TABLE) {
      assert.equal(
        shell('release_is_semver "$1"', version).status === 0,
        isSemver(version),
        version,
      );
      assert.equal(isSemver(version), expected);
    }
  });
  test("release_is_credential_name", () => {
    for (const [name] of CREDENTIAL_NAMES) {
      assert.equal(
        shell('release_is_credential_name "$1"', name).status === 0,
        isCredentialName(name),
        name,
      );
    }
  });
  test("release_failed_step", () => {
    for (const [name, log] of FAILED_LOGS) {
      const out = shell('release_failed_step "$1"', logFile(log));
      assert.equal(out.stdout.trim(), failedStep(log), name);
    }
  });
  test("release_created_tag", () => {
    for (const [name, log] of TAG_LOGS) {
      const out = shell('release_created_tag "$1"', logFile(`${log}\n`));
      assert.equal(out.stdout.replace(/\n$/, ""), createdTag(log), name);
    }
  });
});

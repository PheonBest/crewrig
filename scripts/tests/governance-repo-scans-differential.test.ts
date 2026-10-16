// Differential test of the `repo-scans` group (spec 0259 R26): the real-repository leg of
// each check, and the unchanged Bash suite, through the shell-versus-TypeScript tee.
// The Bash suites are slow (test-check-test-strays takes about a minute), hence the timeouts.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { REPO } from "./lib/build-fixture-tree.ts";
import {
  casesOf,
  checkNeeds,
  runRealRepo,
  runSuiteThroughTee,
} from "./lib/governance-differential.ts";

const REAL_REPO_TIMEOUT_MS = 5 * 60_000;
const SUITE_TIMEOUT_MS = 10 * 60_000;

for (const c of casesOf("repo-scans")) {
  const twin = fs.existsSync(path.join(REPO, "scripts", `${c.name}.ts`));
  const missing = checkNeeds(c);
  const skip = !twin
    ? "TypeScript twin not present"
    : missing.length > 0
      ? `host lacks ${missing.join(", ")}`
      : false;

  test(
    `${c.name}: real repository through the tee`,
    { skip, timeout: REAL_REPO_TIMEOUT_MS },
    () => {
      const t = runRealRepo(c);
      assert.notEqual(t.status, 99);
      assert.equal(t.status, 0, `${t.stdout}${t.stderr}`);
    },
  );

  test(
    `${c.name}: unchanged Bash suite through the tee`,
    { skip: c.suite === null ? "no Bash suite" : skip, timeout: SUITE_TIMEOUT_MS },
    () => {
      runSuiteThroughTee(c);
    },
  );
}

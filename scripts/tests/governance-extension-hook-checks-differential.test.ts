// Differential test of the `extension-hook-checks` group (spec 0259 R26): for every check, the
// real-repository leg and the unchanged Bash suite, both through the shell-versus-TypeScript tee.
// check-extension-hook-tokens is mutating (the tee works on a sandbox copy); the suites copy scripts/,
// so the timeouts are generous.

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

const TIMEOUT = 600_000;

for (const c of casesOf("extension-hook-checks")) {
  const twin = fs.existsSync(path.join(REPO, "scripts", `${c.name}.ts`));
  const missing = checkNeeds(c);
  const skip = !twin
    ? "TypeScript twin not present"
    : missing.length > 0
      ? `host lacks ${missing.join(", ")}`
      : false;

  test(`${c.name}: real repository through the tee`, { skip, timeout: TIMEOUT }, () => {
    const t = runRealRepo(c);
    assert.notEqual(t.status, 99);
    assert.equal(t.status, 0, `${t.stdout}${t.stderr}`);
  });

  test(
    `${c.name}: unchanged Bash suite through the tee`,
    { skip: c.suite === null ? "no Bash suite" : skip, timeout: TIMEOUT },
    () => {
      runSuiteThroughTee(c);
    },
  );
}

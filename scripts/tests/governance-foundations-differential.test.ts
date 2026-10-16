// Differential test of the `foundations` group (spec 0259 R26): the real-repository leg of
// each check through the shell-versus-TypeScript tee. Later PRs add their own
// `governance-<group>-differential.test.ts` with the same shape and their own group name.

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

for (const c of casesOf("foundations")) {
  const twin = fs.existsSync(path.join(REPO, "scripts", `${c.name}.ts`));
  const missing = checkNeeds(c);
  const skip = !twin
    ? "TypeScript twin not present"
    : missing.length > 0
      ? `host lacks ${missing.join(", ")}`
      : false;

  test(`${c.name}: real repository through the tee`, { skip }, () => {
    const t = runRealRepo(c);
    assert.notEqual(t.status, 99);
    assert.equal(t.status, 0, `${t.stdout}${t.stderr}`);
  });

  test(
    `${c.name}: unchanged Bash suite through the tee`,
    { skip: c.suite === null ? "no Bash suite" : skip },
    () => {
      runSuiteThroughTee(c);
    },
  );
}

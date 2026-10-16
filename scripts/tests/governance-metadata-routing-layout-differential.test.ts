// Differential test of the `metadata-routing-layout` group (spec 0259 R26): the real-repository leg of
// each check, and its unchanged Bash suite, through the shell-versus-TypeScript tee. The
// gemini-overlay suite diverges only through python traceback noise, which its case row
// declares as `stderrNoise`.

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

for (const c of casesOf("metadata-routing-layout")) {
  const twin = fs.existsSync(path.join(REPO, "scripts", `${c.name}.ts`));
  const missing = checkNeeds(c);
  const skip = !twin
    ? "TypeScript twin not present"
    : missing.length > 0
      ? `host lacks ${missing.join(", ")}`
      : false;

  test(`${c.name}: real repository through the tee`, { skip, timeout: 300_000 }, () => {
    const t = runRealRepo(c);
    assert.notEqual(t.status, 99);
    assert.equal(t.status, 0, `${t.stdout}${t.stderr}`);
  });

  test(
    `${c.name}: unchanged Bash suite through the tee`,
    { skip: c.suite === null ? "no Bash suite" : skip, timeout: 900_000 },
    () => {
      runSuiteThroughTee(c);
    },
  );
}

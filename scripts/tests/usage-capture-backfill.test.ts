// usage-capture-backfill.test.ts — TypeScript port of group G5 of
// scripts/tests/test-usage-capture.sh (spec 0260, section `test-usage-capture.sh`).
//
//   G5  R24 static guard: backfill.js references neither MemPalace
//       nor any import-*-history.sh script; R24/R23 smoke: backfill.js under an empty,
//       hermetic HOME exits 0 and prints `claude-code: 0 stored`, `gemini-cli: 0 stored`,
//       `copilot-cli: 0 stored` (asserted only here: usage-wrappers-oracle.test.ts uses
//       different wording).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { hermeticEnv, mkTemp, REPO } from "./lib/usage-capture-fixtures.ts";

const BACKFILL_JS = path.join(REPO, "scripts", "lib", "usage-capture", "backfill.js");
const FORBIDDEN = /mempalace|import-(claude|gemini|copilot|antigravity)-history/i;

test("G5 R24: backfill.js references neither MemPalace nor an import-*-history script", () => {
  for (const file of [BACKFILL_JS]) {
    const match = FORBIDDEN.exec(fs.readFileSync(file, "utf8"));
    assert.equal(match, null, `${path.basename(file)} references ${match?.[0]}`);
  }
});

test("G5 R24/R23: backfill.js runs clean (exit 0, 0 stored per CLI) under an empty hermetic HOME", () => {
  const home = mkTemp("crewrig-backfill-home-");
  const root = mkTemp("crewrig-backfill-root-");
  try {
    const res = spawnSync(
      process.execPath,
      ["--disable-warning=ExperimentalWarning", BACKFILL_JS],
      { encoding: "utf8", env: hermeticEnv(home, { CREWRIG_USAGE_ROOT: root }), cwd: home },
    );
    const out = `${res.stdout}${res.stderr}`;
    assert.equal(res.status, 0, out);
    assert.match(out, /^claude-code: 0 stored/m);
    assert.match(out, /^gemini-cli: 0 stored/m);
    assert.match(out, /^copilot-cli: 0 stored/m);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

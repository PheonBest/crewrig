// e2e-judge-differential.test.ts — the TypeScript judge twin against the shell goldens (spec 0261
// R9, PLAN v3 PR 5): every judge case replayed through tests/e2e/lib/llm_judge.ts must produce the
// tuple the shell recorded (rc, stdout, stderr, requests, report files).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { checkExpect } from "./lib/e2e-judge-run.ts";
import { runCaseTs } from "./lib/e2e-judge-ts.ts";
import { JUDGE_CASES } from "./lib/e2e-oracle-judge-cases.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const goldens = path.join(root, "scripts/tests/fixtures/e2e-oracle/judge");

describe("judge twin against the shell goldens", () => {
  for (const c of JUDGE_CASES) {
    const golden = path.join(goldens, c.id, "tuple.json.golden");
    const skip = c.posixOnly === true && process.platform === "win32" ? "POSIX file modes" : false;
    test(c.id, { skip }, async () => {
      const tuple = await runCaseTs(c);
      assert.deepEqual(checkExpect(c, tuple), []);
      assert.deepEqual(
        JSON.parse(JSON.stringify(tuple)),
        JSON.parse(fs.readFileSync(golden, "utf8")),
      );
    });
  }
});

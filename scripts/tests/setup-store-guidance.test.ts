// Tests of scripts/lib/setup/store-guidance.ts (spec 0256 requirements 25 and 32, delta-01 G9).
// The text is replayed against fixtures/setup-store-guidance/guidance.golden.json, recorded from the retired
// shell `print_store_access_guidance` (spec 0266).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { CLIS } from "../lib/setup/context.ts";
import type { Cli } from "../lib/setup/context.ts";
import { printStoreAccessGuidance } from "../lib/setup/store-guidance.ts";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const GOLDEN = JSON.parse(
  readFileSync(
    path.join(repo, "scripts", "tests", "fixtures", "setup-store-guidance", "guidance.golden.json"),
    "utf8",
  ),
) as Record<string, string[]>;

function printed(cli: Cli): string[] {
  const lines: string[] = [];
  printStoreAccessGuidance({ out: (l) => void lines.push(l) }, cli);
  return lines;
}

test("the text equals the recorded shell text for gemini and copilot (vacuity guard: not empty)", () => {
  for (const cli of ["gemini", "copilot"] as const) {
    const expected = GOLDEN[cli] ?? [];
    assert.ok(expected.length > 10, `recorded text for ${cli} is vacuous`);
    assert.deepEqual(printed(cli), expected);
  }
});

test("claude and antigravity print nothing, as the shell's case has no arm for them", () => {
  for (const cli of CLIS.filter((c) => c !== "gemini" && c !== "copilot")) {
    assert.deepEqual(printed(cli), []);
  }
});

test("the guidance names the flags of its CLI and writes nothing", () => {
  assert.ok(printed("gemini").includes("    gemini --skip-trust ..."));
  assert.ok(printed("copilot").includes("    copilot --allow-all-paths"));
  assert.equal(printed("gemini")[0], "");
});

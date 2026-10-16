// setup-legacy-gemini-md-declaration.test.ts — the legacy ~/.gemini/GEMINI.md cleanup declared by
// the gemini and antigravity setups (spec 0061 delta-02, issue #1082), ported from group G1 of
// scripts/tests/test-setup-gemini-md-cleanup.sh (spec 0263, row A). The behaviour (G2) is the
// "legacy GEMINI.md cleanup" describe of setup-retarget-entry-behaviour.test.ts.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { REPO } from "./lib/worktree-fixtures.ts";
import { SETUP_DESCRIPTORS } from "./lib/print-setup-declarations.ts";
import { declarationFacts } from "./lib/setup-declarations-facts.ts";

const FILE = "<HOME>/.gemini/GEMINI.md";
const MARKER = "<!-- crewrig-section:";

describe("legacy GEMINI.md declaration", () => {
  for (const cli of ["antigravity", "gemini"] as const) {
    it(`${cli} declares the legacy file and marker`, () => {
      const descriptor = SETUP_DESCRIPTORS[cli];
      assert.ok(descriptor, `no descriptor for ${cli}`);
      const facts = new Map(declarationFacts(descriptor));
      assert.equal(facts.get("legacy.gemini-md"), FILE);
      assert.equal(facts.get("legacy.marker"), MARKER);
    });
  }

  it("the antigravity step marker constant equals the declared marker", () => {
    const src = fs.readFileSync(path.join(REPO, "scripts", "lib", "setup", "steps-agy.ts"), "utf8");
    const m = /const SECTION_MARK = "([^"]*)";/.exec(src);
    assert.ok(m, "SECTION_MARK constant not found in steps-agy.ts");
    assert.equal(m[1], MARKER);
  });
});

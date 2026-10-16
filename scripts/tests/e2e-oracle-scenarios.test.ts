// e2e-oracle-scenarios.test.ts — the end-to-end oracle for scenarios 01 and 03 (spec 0261 R5, R7,
// R8): every registered case runs against the Docker stand-in and its tuple is compared with the
// recorded golden. The subject is the TypeScript runner once tests/e2e/run.ts exists, else the
// shell runner (bash >= 4, jq and yq required: the run suite skips elsewhere, e.g. macOS bash 3.2).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { cases } from "./lib/e2e-oracle-cases.ts";
import {
  goldenPath,
  observe,
  resolveSubject,
  serialise,
  shellPrerequisites,
} from "./lib/e2e-oracle-observe.ts";

const GOLDENS = path.join(import.meta.dirname, "fixtures", "e2e-oracle", "scenarios");
const DEFAULTS = path.resolve(import.meta.dirname, "..", "..", "tests", "e2e", "defaults.toml");
const ids = cases.map((c) => c.id);

describe("e2e oracle registry", () => {
  it("has unique ids that match scenario/cli/variant", () => {
    assert.equal(new Set(ids).size, ids.length);
    for (const c of cases) assert.equal(c.id, `${c.scenario}/${c.cli}/${c.variant}`);
  });

  it("covers every applies_to CLI of scenarios 01 and 03 with a pass case and a negative", () => {
    const toml = fs.readFileSync(DEFAULTS, "utf8");
    for (const scenario of ["01-layered-context", "03-skill-build"]) {
      const block = toml.split(`[scenarios.${scenario}]`)[1] ?? "";
      const line = /applies_to\s*=\s*\[([^\]]*)\]/.exec(block)?.[1] ?? "";
      const clis = [...line.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
      assert.ok(clis.length > 0, scenario);
      for (const cli of clis) {
        const mine = cases.filter((c) => c.scenario === scenario && c.cli === cli);
        assert.ok(
          mine.some((c) => c.variant === "pass" && c.expectedExit === 0),
          `${scenario}/${cli} pass`,
        );
        assert.ok(
          mine.some((c) => c.expectedExit === 1),
          `${scenario}/${cli} negative`,
        );
      }
    }
  });

  it("gives gemini the exit-124 cases and every docker-running case exactly one fixture", () => {
    assert.ok(ids.includes("01-layered-context/gemini/exit-124-with-answer"));
    for (const c of cases) {
      // Scenarios 01 and 03 each make a single `docker run`; only the empty-bundle skip makes none.
      if (c.scenario.startsWith("01-") || c.scenario.startsWith("03-")) {
        assert.equal(c.fixtures.length, c.variant === "empty-bundle-skip" ? 0 : 1, c.id);
      } else {
        assert.ok(c.fixtures.length <= 4, c.id);
      }
    }
  });

  it("only seeds and writes goldens inside its own tree", () => {
    for (const c of cases) assert.ok(goldenPath("/g", c).startsWith("/g/"), c.id);
  });
});

const shellSkip = resolveSubject("auto") === "shell" ? shellPrerequisites() : null;

describe("e2e oracle scenarios", { skip: shellSkip ?? false }, () => {
  for (const c of cases) {
    it(c.id, (t) => {
      const tuple = observe(c, "auto");
      assert.equal(tuple.exit, c.expectedExit, `runner exit of ${c.id}`);
      const golden = goldenPath(GOLDENS, c);
      if (!fs.existsSync(golden)) {
        t.todo("golden not recorded yet");
        return;
      }
      assert.equal(serialise(tuple), fs.readFileSync(golden, "utf8"));
    });
  }
});

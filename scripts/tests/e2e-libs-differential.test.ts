// e2e-libs-differential.test.ts — every library case recorded from the shell must give the same
// tuple through its TypeScript twin (spec 0261 R9, R10). The goldens are the shell's: they are never
// regenerated from the TypeScript side. A case with no binding yet is reported as todo, and the last
// test of the file lists the unbound ones so that the PR that adds a twin cannot forget a case.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { cases } from "./lib/e2e-oracle-libs-cases.ts";
import { REPO_ROOT } from "./lib/e2e-oracle-libs-observe.ts";
import { bindingFor, observeLibTs } from "./lib/e2e-oracle-libs-ts.ts";
import { EXPECTED_TOML_DEVIATIONS } from "./lib/e2e-oracle-libs-ts-toml.ts";

const GOLDENS = path.join(REPO_ROOT, "scripts", "tests", "fixtures", "e2e-oracle", "libs");

describe("e2e library twins against the recorded shell", () => {
  for (const c of cases) {
    it(c.id, async (t) => {
      if (bindingFor(c) === undefined) return t.todo("no TypeScript twin bound yet");
      const golden = JSON.parse(
        fs.readFileSync(path.join(GOLDENS, c.id, "tuple.json.golden"), "utf8"),
      ) as { rc: number };
      const tuple = await observeLibTs(c);
      const deviation = EXPECTED_TOML_DEVIATIONS.find((d) => d.id === c.id);
      if (deviation !== undefined) {
        // Deviation (b) of spec 0261: the TypeScript reader refuses what yq accepted or words it alone.
        assert.equal(golden.rc, deviation.goldenRc);
        assert.equal(tuple?.rc, deviation.twinRc);
        return t.skip("expected deviation (b): the TypeScript reader refuses the construct");
      }
      assert.deepEqual(tuple, golden);
    });
  }
});

describe("e2e library twins: completeness", () => {
  it("binds every recorded library case to a TypeScript twin", () => {
    const unbound = cases.filter((c) => bindingFor(c) === undefined).map((c) => c.id);
    assert.deepEqual(unbound, []);
  });
});

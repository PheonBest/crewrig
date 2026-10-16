// e2e-oracle-libs.test.ts — registry shape of the library cases (runs anywhere) and the replay of
// each case through the shell libraries against its recorded golden (needs bash >= 4; a missing
// golden is a todo, not a failure). Spec 0261 R9.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { cases } from "./lib/e2e-oracle-libs-cases.ts";
import { cases as markerCases } from "./lib/e2e-oracle-libs-cases-markers.ts";
import { observeLib, REPO_ROOT, shellLibPrerequisites } from "./lib/e2e-oracle-libs-observe.ts";
import { shellLegSkipReason } from "./lib/e2e-shim.ts";

const GOLDENS = path.join(REPO_ROOT, "scripts", "tests", "fixtures", "e2e-oracle", "libs");

function defines(text: string, fn: string): boolean {
  const escaped = fn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}\\s*\\(\\)`, "m").test(text);
}

describe("e2e oracle library registry", () => {
  it("has unique, well-formed ids", () => {
    const ids = cases.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ids) assert.match(id, /^[a-z0-9-]+\/[a-z0-9][a-z0-9-]*$/, id);
  });

  it("registers every marker case", () => {
    const ids = new Set(cases.map((c) => c.id));
    for (const c of markerCases) assert.ok(ids.has(c.id), `${c.id} missing from the registry`);
  });

  it("points every case at an existing library defining its function", () => {
    for (const c of cases) {
      const file = path.join(REPO_ROOT, c.lib);
      assert.ok(fs.existsSync(file), `${c.id}: ${c.lib} does not exist`);
      // `eval` cases wrap the real function in a one-off command line (copilot_ephemeral_home).
      if (c.script !== true && c.fn !== "eval") {
        assert.ok(defines(fs.readFileSync(file, "utf8"), c.fn), `${c.id}: ${c.fn} not in ${c.lib}`);
      }
    }
  });
});

describe("e2e oracle library replay", () => {
  const reason = shellLibPrerequisites();
  for (const c of cases) {
    const golden = path.join(GOLDENS, c.id, "tuple.json.golden");
    // A forwarding shim has no shell behaviour left to replay: the TypeScript twin is proven against
    // the same goldens by e2e-libs-differential.test.ts (spec 0261 requirement 16).
    const skip =
      shellLegSkipReason(path.join(REPO_ROOT, c.lib)) ||
      (reason ?? shellLibPrerequisites(c.tools ?? []) ?? false);
    if (!fs.existsSync(golden)) {
      it(c.id, { todo: "no recorded golden yet" }, () => {});
      continue;
    }
    it(c.id, { skip }, () => {
      assert.deepEqual(observeLib(c), JSON.parse(fs.readFileSync(golden, "utf8")));
    });
  }
});

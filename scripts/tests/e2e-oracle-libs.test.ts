// e2e-oracle-libs.test.ts — registry shape of the library cases (runs anywhere). The replay through the
// shell libraries is removed with them; e2e-libs-differential.test.ts replays every case through its
// TypeScript twin against the recorded goldens. Spec 0261 R9.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cases } from "./lib/e2e-oracle-libs-cases.ts";
import { cases as markerCases } from "./lib/e2e-oracle-libs-cases-markers.ts";

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
});

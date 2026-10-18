// e2e-runner-delegation.test.ts — migrated from test-e2e-runner-delegation.sh (ADR 0005
// Decision 3); spec 0261 R19. The recorder scenario reports the environment the runner hands it.
// The executable-bit gate on a scenario `run.sh` is a requirement-14 assertion and is dropped.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";

import { dryRun, makeRunnerTree } from "./lib/e2e-runner-tree.ts";

const t = makeRunnerTree("crewrig-e2e-delegation");
after(() => t.scratch.cleanup());
const phys = (p: string): string => fs.realpathSync(p);

describe("runner -> scenario delegation", () => {
  const rd = path.join(t.scratch.root, "rd1");
  const r = t.probe(rd, "dummy-not-a-real-key");

  it("sets E2E_LIB_DIR for the scenario script", () => {
    const lib = t.childVar(rd, "E2E_LIB_DIR");
    assert.notEqual(lib, "", r.out);
    assert.equal(phys(lib), phys(path.join(t.tree, "tests/e2e/lib")));
  });

  it("sets E2E_REPORT_DIR for the scenario script", () => {
    const rep = t.childVar(rd, "E2E_REPORT_DIR");
    assert.equal(phys(rep), phys(path.join(rd, "claude/01-layered-context")));
  });

  it("delegates to scenarios/<name>/ (child env, exit 0 maps to ok)", () => {
    assert.equal(
      phys(t.childVar(rd, "E2E_SCENARIO_DIR")),
      phys(path.join(t.tree, "tests/e2e/scenarios/01-layered-context")),
    );
    assert.equal(t.childVar(rd, "E2E_CLI"), "claude");
    assert.notEqual(t.childVar(rd, "E2E_IMAGE"), "");
    assert.match(r.stdout, /^ok 1 - claude\/01-layered-context$/m);
  });
});

describe("runner dry-run and help", () => {
  it("--dry-run exits 0 with no auth and no docker run", () => {
    const r = dryRun(t.scratch, path.join(t.scratch.root, "rep-dry"), ["--dry-run"]);
    assert.equal(r.status, 0, r.out);
    assert.doesNotMatch(r.out, /^\+? *docker run /m);
  });

  it("--help exits 0", () => {
    const r = dryRun(t.scratch, path.join(t.scratch.root, "rep-help"), ["--help"]);
    assert.equal(r.status, 0, r.out);
  });

  it("--dry-run --scenario 01-layered-context exits 0", () => {
    const r = dryRun(t.scratch, path.join(t.scratch.root, "rep-scn"), [
      "--dry-run",
      "--scenario",
      "01-layered-context",
    ]);
    assert.equal(r.status, 0, r.out);
  });
});

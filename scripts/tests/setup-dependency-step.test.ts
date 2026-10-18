// setup-dependency-step.test.ts — the wiring of the production-dependency step in the four setup
// declarations (spec 0240 R4-R6, delta-01 R5; plan v3 Step 10). The shell helper
// `install_production_dependencies` went with scripts/lib/common.sh (spec 0266); its TypeScript twin
// is tested by setup-deps.test.ts.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { renderDeclaration, SETUP_DESCRIPTORS } from "./lib/print-setup-declarations.ts";

describe("setup-script wiring", () => {
  /** The steps of one setup in run order, read from its declaration (`step N: <id>` lines). */
  function declaredSteps(cli: string): string[] {
    const descriptor = SETUP_DESCRIPTORS[cli];
    assert.ok(descriptor !== undefined, cli);
    const steps = renderDeclaration(descriptor, "lines")
      .split("\n")
      .flatMap((line) => /^step \d+: (.+)$/.exec(line)?.[1] ?? []);
    assert.ok(steps.length > 0, `vacuity: the ${cli} declaration lists no step`);
    return steps;
  }

  for (const cli of ["claude", "gemini", "copilot", "antigravity"]) {
    test(`7. ${cli}: tls-offer, then deps-install, then tiers (declaration)`, () => {
      const steps = declaredSteps(cli);
      const tls = steps.indexOf("tls-offer");
      const step = steps.indexOf("deps-install");
      const tier = steps.indexOf("tiers");
      assert.ok(tls >= 0 && step >= 0 && tier >= 0, `${tls} ${step} ${tier}`);
      assert.ok(tls < step, `tls-offer (#${tls}) must precede the step (#${step})`);
      assert.ok(step < tier, `the step (#${step}) must precede tiers (#${tier})`);
    });
  }
});

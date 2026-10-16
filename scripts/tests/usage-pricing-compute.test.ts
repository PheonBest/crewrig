// usage-pricing-compute.test.ts — Cases 1-5, the named ladder (L) and R38 of the
// pricing engine (spec 0260, row J1a; replaces the matching groups of
// test-usage-pricing.sh). Mutants edit a temp copy of the libraries only; a needle
// that is missing throws, so a refactor can never silently disarm an oracle.
// Dropped on purpose: every "X is restored after Case N" assert (nothing is edited
// in place any more).

/* oxlint-disable typescript/no-explicit-any, typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-return -- the driver emits untyped JSON of the CommonJS libraries */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import path from "node:path";
import {
  FIXTURES,
  applyMutation,
  driver,
  driverJson,
  makeCheckout,
  makeRecord,
  mutate,
  pinnedCase,
  writeJson,
  type Case,
  type Checkout,
  type RecordOptions,
} from "./lib/usage-pricing-rig.ts";

const P = "scripts/lib/usage-price";
const lines = (...l: string[]): string => l.join("\n");
const rec = (f: string): string => path.join(FIXTURES, "records", f);

let co: Checkout;
const cases: Case[] = [];
before(() => {
  co = makeCheckout();
});
after(() => {
  co.dispose();
  for (const c of cases) c.dispose();
});

function fresh(): Case {
  const c = pinnedCase(co);
  cases.push(c);
  return c;
}

/** Run `fn` against a pinned case of a checkout carrying one mutation. */
function onMutant<T>(
  rel: string,
  needle: string | RegExp,
  repl: string,
  fn: (m: Checkout, c: Case) => T,
): T {
  const m = mutate(rel, needle, repl);
  const c = pinnedCase(m);
  try {
    return fn(m, c);
  } finally {
    c.dispose();
    m.dispose();
  }
}

function rc(c: Case, name: string, opts: RecordOptions): string {
  return writeJson(c, `${name}.json`, makeRecord(opts));
}

// Case 1 — family fallback carries ~ (R13)
describe("Case 1: family fallback (R13)", () => {
  test("gemini-3.8-pro resolves via family fallback to gemini-3.8-flash, family:true", () => {
    const r = driverJson(co, fresh(), "resolve", ["gemini-3.8-pro"]);
    assert.equal(r.family, true);
    assert.equal(r.entryKey, "gemini-3.8-flash");
  });
  test("MUTATION RED: flipping the family flag off gives family:false", () => {
    onMutant(`${P}/resolve.js`, "family: followed.step === 'family',", "family: false,", (m, c) => {
      assert.equal(driverJson(m, c, "resolve", ["gemini-3.8-pro"]).family, false);
    });
  });
});

// Case 2 — 1-hour tier picks the _above_1hr field (R14/R39)
describe("Case 2: 1-hour cache-write tier (R14/R39)", () => {
  const opts = {
    modelId: "claude-sonnet-4-5",
    netInput: 1000,
    cacheWrite: { "1hr": 500 },
    output: 100,
  };
  test("priced at cache_creation_input_token_cost_above_1hr, amountUsd 0.0075", () => {
    const c = fresh();
    const p = driverJson(co, c, "resolve-and-compute", [rc(c, "c2", opts)]);
    assert.equal(p.components.cacheWrite[0].field, "cache_creation_input_token_cost_above_1hr");
    assert.equal(String(p.amountUsd), "0.0075");
  });
  test("MUTATION RED: the base field prices cache_creation_input_token_cost instead", () => {
    const needle = lines(
      "function cacheWriteBaseField(tierKey) {",
      "  if (tierKey && /^(1h|1hr|3600)$/i.test(tierKey)) return 'cache_creation_input_token_cost_above_1hr';",
      "  return 'cache_creation_input_token_cost';",
      "}",
    );
    const repl = lines(
      "function cacheWriteBaseField(tierKey) {",
      "  return 'cache_creation_input_token_cost';",
      "}",
    );
    onMutant(`${P}/compute.js`, needle, repl, (m, c) => {
      const p = driverJson(m, c, "resolve-and-compute", [rc(c, "c2", opts)]);
      assert.equal(p.components.cacheWrite[0].field, "cache_creation_input_token_cost");
    });
  });
});

// Case 3 — compound threshold composes on the R14-selected field (R14/R18/R39)
describe("Case 3: compound threshold (R14/R18/R39)", () => {
  const opts = {
    modelId: "claude-sonnet-4-5",
    netInput: 250000,
    cacheWrite: { "1hr": 1000 },
    output: 100,
  };
  const field = "cache_creation_input_token_cost_above_1hr_above_200k_tokens";
  test("compound field composes on the selected 1hr field; netInput uses the 200k field", () => {
    const c = fresh();
    const p = driverJson(co, c, "resolve-and-compute", [rc(c, "c3", opts)]);
    assert.equal(p.components.cacheWrite[0].field, field);
    assert.equal(p.components.netInput.field, "input_cost_per_token_above_200k_tokens");
  });
  test("MUTATION RED: a sibling built from the base field name loses the composition", () => {
    const needle = lines(
      "function siblingField(baseField, threshold) {",
      "  return `${baseField}_above_${suffixFor(threshold)}_tokens`;",
      "}",
    );
    const repl = lines(
      "function siblingField(baseField, threshold) {",
      "  return `cache_creation_input_token_cost_above_${suffixFor(threshold)}_tokens`;",
      "}",
    );
    onMutant(`${P}/compute.js`, needle, repl, (m, c) => {
      const p = driverJson(m, c, "resolve-and-compute", [rc(c, "c3", opts)]);
      assert.notEqual(p.components.cacheWrite[0].field, field);
    });
  });
});

// Case 4 — reasoning never added on top of output (R16/R39); exact doubles pin evaluation order
describe("Case 4: reasoning never added on top of output (R16/R39)", () => {
  const eq = { modelId: "gemini-3.8-flash", netInput: 100, output: 50, reasoning: 20 };
  const div = {
    modelId: "dashscope/reasoning-diverge-model",
    netInput: 100,
    output: 50,
    reasoning: 20,
  };
  test("reasoning-equal entry: no flag, amountUsd 0.000044999999999999996", () => {
    const c = fresh();
    const p = driverJson(co, c, "compute-price", [rc(c, "c4e", eq)]);
    assert.deepEqual(p.unpricedComponents, []);
    assert.equal(String(p.amountUsd), "0.000044999999999999996");
  });
  test("reasoning-divergent entry: reasoning-rate-divergence, amountUsd 0.00019999999999999998", () => {
    const c = fresh();
    const p = driverJson(co, c, "compute-price", [rc(c, "c4d", div)]);
    assert.deepEqual(p.unpricedComponents, ["reasoning-rate-divergence"]);
    assert.equal(String(p.amountUsd), "0.00019999999999999998");
  });
  test("MUTATION RED: adding a reasoning term changes the price", () => {
    const needle = lines(
      "  if (reasoning > 0 && reasoningRate !== undefined && outputRate !== undefined && reasoningRate !== outputRate) {",
      "    unpricedComponents.push('reasoning-rate-divergence');",
      "  }",
    );
    const repl = lines(
      "  if (reasoning > 0 && reasoningRate !== undefined && outputRate !== undefined && reasoningRate !== outputRate) {",
      "    unpricedComponents.push('reasoning-rate-divergence');",
      "    amountUsd += reasoning * reasoningRate;",
      "  }",
    );
    onMutant(`${P}/compute.js`, needle, repl, (m, c) => {
      const p = driverJson(m, c, "compute-price", [rc(c, "c4d", div)]);
      assert.notEqual(String(p.amountUsd), "0.00019999999999999998");
    });
  });
});

// Case 5 — the long-context override applies to the whole request (R18/R39)
describe("Case 5: _above_200k applies to the whole request (R18/R39)", () => {
  const opts = { modelId: "claude-sonnet-4-5", netInput: 250000, cacheWrite: 0, output: 100 };
  test("the whole 250000-token request prices at the override rate (netInput 1.5)", () => {
    const c = fresh();
    const p = driverJson(co, c, "resolve-and-compute", [rc(c, "c5", opts)]);
    assert.equal(String(p.components.netInput.amountUsd), "1.5");
  });
  test("MUTATION RED: pricing only the excess yields 0.3 instead of 1.5", () => {
    const head = lines(
      "  if (netInput > 0) {",
      "    const picked = rateFor(entry, 'input_cost_per_token', threshold);",
      "    if (picked) {",
    );
    const needle = `${head}\n      const amt = netInput * picked.rate;`;
    const repl = `${head}\n      const amt = (threshold !== null && picked.field !== 'input_cost_per_token') ? (netInput - threshold) * picked.rate : netInput * picked.rate;`;
    onMutant(`${P}/compute.js`, needle, repl, (m, c) => {
      const p = driverJson(m, c, "resolve-and-compute", [rc(c, "c5", opts)]);
      assert.equal(String(p.components.netInput.amountUsd), "0.3");
    });
  });
});

// Ladder L — named ladder fixtures (v1-F2)
describe("Ladder L: named ladder fixtures (v1-F2)", () => {
  const NAME = "Gemini 3.8 Flash (Medium)";
  test("Gemini 3.8 Flash (Medium) resolves through the composed closure to gemini-3.8-flash (step exact)", () => {
    const r = driverJson(co, fresh(), "resolve", [NAME]);
    assert.equal(r.step, "exact");
    assert.equal(r.entryKey, "gemini-3.8-flash");
  });
  test("gpt-5-copilot is an expected family fallback onto gpt-5", () => {
    const r = driverJson(co, fresh(), "resolve", ["gpt-5-copilot"]);
    assert.equal(r.family, true);
    assert.equal(r.entryKey, "gpt-5");
  });
  test("MUTATION RED (A): a non-composing ladder leaves the required hit unpriced", () => {
    onMutant(
      `${P}/resolve.js`,
      "const REWRITE_GENERATORS = [genLower, genSlug, genVsep, genEffort, genChan, genDated];",
      "const REWRITE_GENERATORS = [];",
      (m, c) => assert.equal(!!driverJson(m, c, "resolve", [NAME]).unpriced, true),
    );
  });
  test("MUTATION RED (B): an effort token stripped without its separator run loses the clean exact hit", () => {
    const toks = "${EFFORT_TOKENS.join('|')}";
    const needle = `\`${String.raw`\\s*\\((`}${toks}${String.raw`)\\)\\s*$`}\``;
    const repl = `\`${String.raw`\\((`}${toks}${String.raw`)\\)\\s*$`}\``;
    const m = mutate(`${P}/resolve.js`, needle, repl);
    // the second safeguard (hyphen trim) must be disabled together with the first
    // (either alone still saves the closure), so the same copy gets the second edit
    try {
      applyMutation(m, `${P}/resolve.js`, ".replace(/^-+|-+$/g, '');", ";");
      const c = pinnedCase(m);
      try {
        const r = driverJson(m, c, "resolve", [NAME]);
        assert.ok(r.step !== "exact" || r.family === true, JSON.stringify(r));
      } finally {
        c.dispose();
      }
    } finally {
      m.dispose();
    }
  });
});

// R38 — full resolution pipeline: exact / alias / org precedence / unresolvable
describe("R38: full resolution pipeline", () => {
  const org = { PRICE_ORG_FILE: path.join(FIXTURES, "org", "model-prices.org.json") };
  let c: Case;
  before(() => {
    c = fresh();
  });
  test("R38: a sample-derived claude-code record resolves via an exact match; R4 sourceUrl absent", () => {
    const r = driverJson(co, c, "compute-price", [rec("exact-match-claude-code.json")]);
    assert.equal(r.resolution.step, "exact");
    assert.equal(r.resolution.sourceUrl, undefined);
  });
  test("R38: an aliasOf record re-resolves to claude-sonnet-4-6; R4 sourceUrl is the LiteLLM URL", () => {
    const r = driverJson(co, c, "compute-price", [rec("alias-resolution-gemini.json")]);
    assert.equal(r.resolution.step, "alias");
    assert.equal(r.resolution.entryKey, "claude-sonnet-4-6");
    assert.equal(r.resolution.sourceUrl, "https://models.litellm.ai/pricing#claude-sonnet-4-6");
  });
  test("MUTATION RED: dropping the R4 sourceUrl thread makes it absent", () => {
    onMutant(`${P}/store.js`, "if (sourceUrl) resolution.sourceUrl = sourceUrl;", "", (m, mc) => {
      const r = driverJson(m, mc, "compute-price", [rec("alias-resolution-gemini.json")]);
      assert.equal(r.resolution.sourceUrl, undefined);
    });
  });
  test("R38: the org override table takes precedence (org-exact, rate 0.000001)", () => {
    const r = driverJson(co, c, "resolve-and-compute", [rec("exact-match-claude-code.json")], org);
    assert.equal(r.resolution.step, "org-exact");
    assert.equal(String(r.components.netInput.rate), "0.000001");
  });
  test("R38: an identifier only the org table declares resolves at org-added", () => {
    assert.equal(driverJson(co, c, "resolve", ["org-only-custom-model"], org).step, "org-added");
  });
  test("R38: an unresolvable identifier gets the unpriced marker", () => {
    const r = driver(co, c, "resolve", ["totally-unresolvable-model-xyz-987"]);
    assert.equal(!!JSON.parse(r.stdout).unpriced, true);
  });
  test("R20/R21: a Copilot record without a first-party price carries legacy-plan-reference-price", () => {
    const r = driverJson(co, c, "compute-price", [rec("copilot-legacy-plan.json")], org);
    assert.equal(r.resolution.step, "exact");
    assert.equal(r.copilot.caveat, "legacy-plan-reference-price");
  });
});

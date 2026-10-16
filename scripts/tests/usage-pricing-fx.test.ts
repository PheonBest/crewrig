// usage-pricing-fx.test.ts — Cases 6-10 of the pricing engine (spec 0260, row J1a;
// replaces the matching groups of test-usage-pricing.sh): fixing direction, the
// freshness gate, offline staleness, the three timestamps and --as-of-today. Mutants
// edit a temp copy only; a missing needle throws. The "restored" asserts of the Bash
// suite are dropped (nothing is edited in place).

/* oxlint-disable typescript/no-explicit-any, typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-return -- the driver emits untyped JSON of the CommonJS libraries */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";
import {
  FIXTURES,
  caseRoot,
  driver,
  driverJson,
  makeCheckout,
  makeRecord,
  mutate,
  pinnedCase,
  seedFx,
  writeJson,
  type Case,
  type Checkout,
} from "./lib/usage-pricing-rig.ts";

const P = "scripts/lib/usage-price";
const lines = (...l: string[]): string => l.join("\n");
const fx = (d: string): string => path.join(FIXTURES, "fx", `${d}.json`);

let co: Checkout;
const cases: Case[] = [];
before(() => {
  co = makeCheckout();
});
after(() => {
  co.dispose();
  for (const c of cases) c.dispose();
});

function track(c: Case): Case {
  cases.push(c);
  return c;
}

/** fx-resolve: the JSON line and the FETCHER_CALLS counter. */
function fxResolve(
  m: Checkout,
  c: Case,
  date: string,
  extra: Record<string, string | undefined> = {},
  // oxlint-disable-next-line typescript/no-explicit-any
): { value: any; calls: string } {
  const r = driver(m, c, "fx-resolve", [date], extra);
  assert.equal(r.status, 0);
  const [json = "", calls = ""] = r.stdout.split("\n");
  return { value: JSON.parse(json), calls };
}

function withMutantCase<T>(
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

// Case 6 — fixing search direction (R22/R40)
describe("Case 6: fixing search direction (R22/R40)", () => {
  const seeded = (m: Checkout): Case => {
    const c = track(caseRoot());
    seedFx(m, c, "2026-09-18");
    seedFx(m, c, "2026-09-21");
    return c;
  };
  test("the deliberate gap resolves to the previous fixing 2026-09-18, never the later one", () => {
    assert.equal(fxResolve(co, seeded(co), "2026-09-19").value.fixingDate, "2026-09-18");
  });
  test("MUTATION RED: reversing the direction picks the later fixing 2026-09-21", () => {
    const needle = lines(
      "function selectFixing(date) {",
      "  const dates = listCachedDates();",
      "  let chosen = null;",
      "  for (const d of dates) {",
      "    if (d <= date) chosen = d;",
      "    else break;",
      "  }",
      "  return chosen;",
      "}",
    );
    const repl = lines(
      "function selectFixing(date) {",
      "  const dates = listCachedDates();",
      "  for (const d of dates) {",
      "    if (d >= date) return d;",
      "  }",
      "  return null;",
      "}",
    );
    const m = mutate(`${P}/fx.js`, needle, repl);
    try {
      assert.equal(fxResolve(m, seeded(m), "2026-09-19").value.fixingDate, "2026-09-21");
    } finally {
      m.dispose();
    }
  });
});

// Case 7 — the freshness gate (R22/R29/R40); OFFLINE is deleted in the child env only
describe("Case 7: fixing freshness gate (R22/R29/R40)", () => {
  const live = { CREWRIG_USAGE_OFFLINE: undefined, FX_INJECT_SEED_FILE: fx("2026-09-21") };
  const seeded = (m: Checkout): Case => {
    const c = track(caseRoot());
    seedFx(m, c, "2026-09-18");
    return c;
  };
  test("the gate fires, refreshes once, resolves 2026-09-21 with no fxStaleness", () => {
    const r = fxResolve(co, seeded(co), "2026-09-21", live);
    assert.equal(r.value.fixingDate, "2026-09-21");
    assert.equal(Object.prototype.hasOwnProperty.call(r.value, "fxStaleness"), false);
    assert.equal(r.calls, "FETCHER_CALLS=1");
  });
  test("MUTATION RED: with the gate neutralised no refresh is attempted, stale 2026-09-18 used", () => {
    const m = mutate(
      `${P}/fx.js`,
      "const gateFires = !newest || newest < date;",
      "const gateFires = !newest;",
    );
    try {
      const r = fxResolve(m, seeded(m), "2026-09-21", live);
      assert.equal(r.value.fixingDate, "2026-09-18");
      assert.equal(r.calls, "FETCHER_CALLS=0");
    } finally {
      m.dispose();
    }
  });
});

// Case 8 — fxStaleness when the refresh is suppressed (R22/R41)
describe("Case 8: fxStaleness present when the gate is suppressed (R22/R41)", () => {
  const seeded = (m: Checkout): Case => {
    const c = track(caseRoot());
    seedFx(m, c, "2026-09-18");
    return c;
  };
  test("OFFLINE suppresses the refresh: 2026-09-18, fxStaleness {ageDays 3, reason offline}, 0 fetches", () => {
    const r = fxResolve(co, seeded(co), "2026-09-21");
    assert.equal(r.value.fixingDate, "2026-09-18");
    assert.equal(r.value.fxStaleness.ageDays, 3);
    assert.equal(r.value.fxStaleness.reason, "offline");
    assert.equal(r.calls, "FETCHER_CALLS=0");
  });
  test("MUTATION RED: fxStaleness is silently omitted under OFFLINE", () => {
    const m = mutate(
      `${P}/fx.js`,
      lines("  if (staleReason) {", "    result.fxStaleness = {"),
      lines("  if (false && staleReason) {", "    result.fxStaleness = {"),
    );
    try {
      const r = fxResolve(m, seeded(m), "2026-09-21");
      assert.equal(Object.prototype.hasOwnProperty.call(r.value, "fxStaleness"), false);
    } finally {
      m.dispose();
    }
  });
});

// Case 9 — the three timestamps (R27/R41)
describe("Case 9: three timestamps present (R27/R41)", () => {
  const price = (m: Checkout, c: Case, session: string) => {
    seedFx(m, c, "2026-09-21");
    const file = writeJson(
      c,
      `c9-${session}.json`,
      makeRecord({ session, idemKey: session, modelId: "claude-sonnet-5" }),
    );
    return driverJson(m, c, "price-record", [file], { PRICE_CURRENCY: "EUR" });
  };
  test("the price carries snapshot.sha, fixingDate and computedAt", () => {
    const c = track(pinnedCase(co));
    const p = price(co, c, "case9-session");
    assert.ok(typeof p.snapshot?.sha === "string" && p.snapshot.sha !== "");
    assert.ok(typeof p.fixingDate === "string" && p.fixingDate !== "");
    assert.ok(typeof p.computedAt === "string" && p.computedAt !== "");
  });
  test("MUTATION RED: dropping computedAt from the literal removes it from the price", () => {
    const needle = lines("    fixingDate: null,", "    computedAt,", "    resolution,");
    withMutantCase(
      `${P}/store.js`,
      needle,
      lines("    fixingDate: null,", "    resolution,"),
      (m, c) => {
        const p = price(m, c, "case9-session-mut");
        assert.equal(Object.prototype.hasOwnProperty.call(p, "computedAt"), false);
      },
    );
  });
});

// Case 10 — --as-of-today re-resolves (R28/R41); real 1.1 s waits
describe("Case 10: --as-of-today re-resolves (R28/R41)", () => {
  async function twice(m: Checkout, c: Case, session: string) {
    const file = writeJson(
      c,
      `c10-${session}.json`,
      makeRecord({ session, idemKey: session, modelId: "claude-sonnet-5" }),
    );
    const first = driverJson(m, c, "price-record", [file]);
    await sleep(1100);
    const second = driverJson(m, c, "price-record", [file], { PRICE_AS_OF_TODAY: "1" });
    return [first.computedAt, second.computedAt];
  }
  test("--as-of-today re-resolves a fresh computedAt", async () => {
    const [a, b] = await twice(co, track(pinnedCase(co)), "case10-session");
    assert.notEqual(a, b);
  });
  test("MUTATION RED: --as-of-today carries the stored computedAt forward", async () => {
    const m = mutate(
      `${P}/store.js`,
      "if (!asOfToday && fs.existsSync(filePath)) {",
      "if (fs.existsSync(filePath)) {",
    );
    const c = pinnedCase(m);
    try {
      const [a, b] = await twice(m, c, "case10-session-mut");
      assert.equal(a, b);
    } finally {
      c.dispose();
      m.dispose();
    }
  });
});

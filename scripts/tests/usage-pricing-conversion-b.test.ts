// usage-pricing-conversion-b.test.ts — mutants M19-1..M19-5 of the delta-02 conversion
// group (spec 0260, row J1a). Each mutant edits a TEMP COPY of one library; a missing
// needle throws (a FAIL, never a skip). Every state is rebuilt per mutant (M19-3
// rebuilds the 19e state rather than inheriting it). The Bash "X is restored after
// M19-n" asserts are dropped on purpose: nothing is edited in place any more.
// Entry-spawning, so POSIX-gated (SKIP_POSIX first).

/* oxlint-disable typescript/no-explicit-any, typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-argument -- the entries emit untyped JSON */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { approx, driver, mutate, pinnedCase } from "./lib/usage-pricing-rig.ts";
import { World, pairCalls, sum } from "./lib/usage-pricing-conversion-world.ts";
import { SKIP_POSIX } from "./lib/worktree-fixtures.ts";

const P = "scripts/lib/usage-price";

/** A mutated checkout, a seeded world on it, `fn`, then cleanup. */
function onMutant<T>(
  rel: string,
  needle: string,
  repl: string,
  fresh: boolean,
  fn: (w: World) => T,
): T {
  const m = mutate(rel, needle, repl);
  const w = new World(m, pinnedCase(m));
  try {
    if (fresh) w.seedRoot();
    return fn(w);
  } finally {
    w.c.dispose();
    m.dispose();
  }
}

describe("Case 19 mutants (delta-02)", { skip: SKIP_POSIX }, () => {
  test("MUTATION RED (M19-1 -> 19a): labelling a failure with the requested currency states EUR on a USD amount", () => {
    const needle = "if (converted.conversion.status === 'ok') {";
    onMutant(`${P}/store.js`, needle, "if (true) { // MUTATION", true, (w) => {
      const p = w.price("p1", "EUR");
      assert.equal(p.currency, "EUR");
      assert.equal(p.conversion?.status, "no-fixing-on-or-before");
    });
  });

  test("MUTATION RED (M19-2 -> 19e): dropping the consulted fixing date leaves the JPY failure with fixingDate null", () => {
    const needle =
      "conversion: { status: 'no-such-currency', requested: ccy, fixingDate: resolved.fixingDate } };";
    const repl = "conversion: { status: 'no-such-currency', requested: ccy } }; // MUTATION";
    onMutant(`${P}/fx.js`, needle, repl, true, (w) => {
      w.seedFx();
      const p = w.price("p1", "JPY");
      assert.equal(p.conversion?.status, "no-such-currency");
      assert.equal(p.fixingDate, null);
    });
  });

  test("MUTATION RED (M19-3 -> 19f(1), 19f(2), 19f(3), 19g): without the R52 status guard stored failures are served", () => {
    const needle =
      "  if (!stored.conversion || !USABLE_CONVERSION_STATUSES.has(stored.conversion.status)) return false;";
    onMutant(`${P}/store.js`, needle, "  // MUTATION: R52 status guard removed", true, (w) => {
      w.seedFx();
      w.rollup("JPY");
      const dash = w.dash("USD");
      const p1 = w.price("p1");
      const roll = w.rollup("USD");
      w.plantLegacy();
      const legacy = w.price("p1", "EUR");
      assert.ok(
        dash.totals.price.unconvertedCount > 0,
        "19f(1): dashboard USD view serves stored failures",
      );
      assert.equal(p1.conversion?.status, "no-such-currency", "19f(2)");
      assert.ok(roll.combined.unconvertedCount > 0, "19f(3)");
      assert.equal(legacy.conversion?.status, "no-fixing-on-or-before", "19g");
    });
  });

  test("MUTATION RED (M19-4 -> 19b): summing unconverted amounts adds p1's 0.006 USD into the EUR per-request sum", () => {
    const needle = "        unconvertedCount += 1;";
    const repl = `${needle}\n        sum += price.amount; // MUTATION`;
    onMutant(`${P}/rollup.js`, needle, repl, true, (w) => {
      const r = w.rollup("EUR");
      const s = sum(`${r.byFidelity["per-request"].sum}`);
      assert.ok(!approx(s, w.p0Eur as number));
      assert.ok(approx(s, (w.p0Eur as number) + 0.006));
    });
  });

  test("MUTATION RED (M19-5 -> 19h): bypassing the memo makes one refresh attempt per record (3 per pass)", () => {
    const needle = "  if (!(ctx.fxMemo instanceof Map)) return resolveOnce(date, ctx);";
    const repl = "  return resolveOnce(date, ctx); // MUTATION: per-pass memo bypassed";
    onMutant(`${P}/fx.js`, needle, repl, false, (w) => {
      w.write("p0", "p1", "p2");
      const out = driver(w.co, w.c, "rollup-fetch-count", ["2026-09", "EUR"]).stdout;
      assert.deepEqual(pairCalls(out), ["FETCHER_CALLS=3", "FETCHER_CALLS=3"]);
    });
  });
});

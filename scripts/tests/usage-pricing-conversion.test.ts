// usage-pricing-conversion.test.ts — the delta-02 conversion group of the pricing engine
// (spec 0260, row J1a; replaces the second "Case 19", sub-cases 19a-19h, of
// test-usage-pricing.sh; mutants M19-1..M19-5 live in usage-pricing-conversion-b.test.ts).
// The group is STATEFUL and runs in order inside one describe: 19d seeds the fixings
// 19e reads, 19e leaves the stored JPY failures 19f and 19g consume. 19h builds its own
// root. Every entry spawn is POSIX-gated (SKIP_POSIX first).

/* oxlint-disable typescript/no-explicit-any, typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-return, typescript/no-unsafe-argument -- the entries emit untyped JSON */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import {
  approx,
  driver,
  makeCheckout,
  pinnedCase,
  type Checkout,
} from "./lib/usage-pricing-rig.ts";
import {
  World,
  bucket,
  dashSc,
  noUnconverted,
  pairCalls,
  partition,
  s1Fixing,
  sum,
  tail,
} from "./lib/usage-pricing-conversion-world.ts";
import { SKIP_POSIX } from "./lib/worktree-fixtures.ts";

let co: Checkout;
before(() => {
  co = makeCheckout();
});
after(() => co?.dispose());

describe(
  "Case 19 (delta-02): a failed conversion is labelled USD, tallied apart, re-attempted (R51-R54, R56)",
  { skip: SKIP_POSIX },
  () => {
    let w: World;
    let scBucket = "";
    before(() => {
      w = new World(co, pinnedCase(co)).seedRoot();
    });
    after(() => w?.c.dispose());

    test("setup: p0 stored a converted EUR price while the fixtures were cached", () => {
      assert.notEqual(w.p0Eur, "not-converted");
    });

    test("19a R51: an EUR price with no fixing on or before the date keeps its USD amount, labelled USD; status no-fixing-on-or-before, requested EUR, no fixing date", () => {
      const p = w.price("p1", "EUR");
      assert.ok(
        p.amountUsd > 0 && p.amount === p.amountUsd && p.currency === "USD",
        JSON.stringify(p),
      );
      assert.equal(p.conversion?.status, "no-fixing-on-or-before");
      assert.equal(p.conversion.requested, "EUR");
      assert.equal(p.fixingDate, null);
    });

    test("19b R53/R54/R34/R51: the EUR rollup tallies failures apart and stores s1b labelled USD", () => {
      const r = w.rollup("EUR");
      assert.equal(r.currency, "EUR");
      const pr = bucket(r, "per-request");
      assert.ok(approx(sum(pr), w.p0Eur as number), `per-request sum ${pr}`);
      assert.equal(tail(pr), "3|1|1|1");
      const sc = bucket(r, "session-cumulative");
      scBucket = sc;
      assert.ok(approx(sum(sc), 0));
      assert.equal(tail(sc), "1|0|0|1");
      assert.ok(
        r.byFidelity["run-total"] &&
          r.byFidelity["run-total"].count === 0 &&
          r.byFidelity["run-total"].unconvertedCount === 0,
      );
      assert.ok(approx(r.combined.sum, w.p0Eur as number));
      assert.ok(
        r.combined.unconvertedCount === 2 &&
          r.combined.unpricedCount === 1 &&
          r.uncapturedCount === 1,
      );
      assert.ok(partition(r), "priced + unpriced + unconverted = count in every bucket");
      const s1b = w.stored("s1b");
      assert.ok(
        s1b.currency === "USD" &&
          s1b.amount === s1b.amountUsd &&
          s1b.conversion?.status === "no-fixing-on-or-before" &&
          s1b.fixingDate === null,
      );
    });

    test("19c R47: the dashboard agrees over the same empty FX cache; s1b has no fixing date on both surfaces", () => {
      const d = w.dash("EUR");
      assert.ok(approx(Number(dashSc(d).split("|")[0]), sum(scBucket)));
      assert.equal(tail(dashSc(d)), tail(scBucket).split("|").slice(1).join("|"));
      assert.equal(s1Fixing(d) ?? null, null);
      assert.equal(w.stored("s1b").fixingDate, null);
    });

    test("19d R52/R53: once a fixing is available, a second EUR request converts (ok, EUR, ECB, 2026-09-21) and the rollup converts p1 and s1b", () => {
      w.seedFx();
      const p = w.price("p1", "EUR");
      assert.ok(
        p.conversion?.status === "ok" &&
          p.currency === "EUR" &&
          p.conversion.rateOfRecord === "ECB" &&
          p.fixingDate === "2026-09-21",
        JSON.stringify(p),
      );
      assert.ok(approx(p.amount, p.amountUsd / 1.149));
      const r = w.rollup("EUR");
      assert.ok(
        noUnconverted(r) &&
          r.byFidelity["per-request"].pricedCount === 2 &&
          r.byFidelity["session-cumulative"].pricedCount === 1,
      );
      assert.ok(approx(r.byFidelity["per-request"].sum, 0.009 / 1.149));
      assert.ok(approx(r.byFidelity["session-cumulative"].sum, 0.0012 / 1.149));
    });

    test("19e R51/R53/R54/R47 (v1-F3): JPY has no rate; USD labelled, status no-such-currency, fixing 2026-09-21; rollup and dashboard agree", () => {
      const p = w.price("p1", "JPY");
      assert.ok(p.amountUsd > 0 && p.amount === p.amountUsd && p.currency === "USD");
      assert.ok(
        p.conversion?.status === "no-such-currency" &&
          p.conversion.requested === "JPY" &&
          p.fixingDate === "2026-09-21",
        JSON.stringify(p),
      );
      const r = w.rollup("JPY");
      const pr = bucket(r, "per-request");
      const sc = bucket(r, "session-cumulative");
      assert.ok(approx(sum(pr), 0) && approx(sum(sc), 0));
      assert.equal(tail(pr), "3|0|1|2");
      assert.equal(tail(sc), "1|0|0|1");
      assert.ok(
        r.combined.sum === 0 && r.combined.unconvertedCount === 3 && r.combined.unpricedCount === 1,
      );
      assert.ok(partition(r));
      const d = w.dash("JPY");
      assert.ok(approx(Number(dashSc(d).split("|")[0]), sum(sc)));
      assert.equal(tail(dashSc(d)), tail(sc).split("|").slice(1).join("|"));
      assert.deepEqual(s1Fixing(d), { min: "2026-09-21", max: "2026-09-21" });
      assert.equal(w.stored("s1b").fixingDate, "2026-09-21");
    });

    test("19f R52 x R51: USD requests over stored failures labelled USD recompute (dashboard, per-record, rollup)", () => {
      const d = w.dash("USD").totals.price;
      assert.ok(
        d.unconvertedCount === 0 && d.pricedCount === 3 && d.unpricedCount === 1,
        `19f(1) ${JSON.stringify(d)}`,
      );
      const p = w.price("p1");
      assert.ok(
        p.conversion?.status === "ok" &&
          !Object.hasOwn(p.conversion, "requested") &&
          p.currency === "USD",
        `19f(2) ${JSON.stringify(p)}`,
      );
      const r = w.rollup("USD");
      assert.ok(
        noUnconverted(r) &&
          r.byFidelity["per-request"].pricedCount === 2 &&
          r.byFidelity["session-cumulative"].pricedCount === 1,
      );
      assert.ok(approx(r.byFidelity["per-request"].sum, 0.009));
      assert.ok(approx(r.byFidelity["session-cumulative"].sum, 0.0012));
    });

    test("19g R52: a pre-delta stored failure (USD amount labelled EUR) is recomputed, not served, and converts", () => {
      w.plantLegacy();
      const p = w.price("p1", "EUR");
      assert.ok(
        p.conversion?.status === "ok" &&
          p.currency === "EUR" &&
          p.conversion.rateOfRecord === "ECB" &&
          p.fixingDate === "2026-09-21",
        JSON.stringify(p),
      );
    });

    test("19h R52/R53: one refresh attempt per date per pass (1 then 1) and all three records unconverted in both passes", () => {
      const h = new World(co, pinnedCase(co));
      try {
        h.write("p0", "p1", "p2");
        const out = driver(co, h.c, "rollup-fetch-count", ["2026-09", "EUR"]).stdout;
        assert.deepEqual(pairCalls(out), ["FETCHER_CALLS=1", "FETCHER_CALLS=1"]);
        const l = out.split("\n");
        for (const i of [0, 2]) {
          const b = JSON.parse(l[i]!).byFidelity["per-request"];
          assert.ok(
            b.unconvertedCount === 3 && b.pricedCount === 0 && b.sum === 0,
            `pass ${i / 2 + 1}`,
          );
        }
      } finally {
        h.c.dispose();
      }
    });
  },
);

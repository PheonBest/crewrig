// usage-pricing-rollup-period.test.ts — Cases 17, 18 and 19 (task-key) of the pricing
// engine (spec 0260, row J1a; replaces the matching groups of test-usage-pricing.sh):
// period placement of session-cumulative sessions, the dashboard/query agreement (R47),
// the prune-survival rule (R48). Fixed dates throughout; the mutant edits a temp copy.

/* oxlint-disable typescript/no-explicit-any, typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-return, typescript/no-unsafe-argument -- the entries emit untyped JSON */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { SKIP_POSIX } from "./lib/worktree-fixtures.ts";
import { json, onMutant, put } from "./lib/usage-pricing-case-kit.ts";
import {
  approx,
  entry,
  makeCheckout,
  pinnedCase,
  type Case,
  type Checkout,
} from "./lib/usage-pricing-rig.ts";

let co: Checkout;
const cases: Case[] = [];
before(() => {
  co = makeCheckout();
});
after(() => {
  co.dispose();
  for (const c of cases) c.dispose();
});

function fresh(m: Checkout = co): Case {
  const c = pinnedCase(m);
  cases.push(c);
  return c;
}

// --- Cases 17-19 — period placement of session-cumulative sessions -------------
const SC = "session-cumulative";
const sc = (
  m: Checkout,
  c: Case,
  session: string,
  key: string,
  at: string,
  net: number,
  model?: string,
) =>
  put(m, c, key, {
    session,
    idemKey: key,
    requestInstant: at,
    netInput: net,
    output: 0,
    fidelity: SC,
    modelId: model ?? "claude-sonnet-5",
  });
/** The session-cumulative bucket of usage-price --rollup. */
const priceSc = (m: Checkout, c: Case, ...sel: string[]): any =>
  json(entry(m, c, "usage-price", [...sel, "--rollup"])).byFidelity[SC];
/** The dashboard's session-cumulative figures for --period (and any further selection). */
function dashSc(m: Checkout, c: Case, period: string, ...sel: string[]) {
  const v = json(entry(m, c, "usage-dashboard", ["report", "--json", "--period", period, ...sel]));
  const p = v.totals.price.byFidelity[SC] ?? {};
  return {
    amount: p.amount,
    priced: p.pricedCount,
    unpriced: p.unpricedCount,
    net: (v.totals.tokens.byFidelity[SC] ?? {}).netInput,
  };
}
const queryNet = (m: Checkout, c: Case, period: string, ...sel: string[]): any =>
  json(entry(m, c, "usage-query", ["--period", period, ...sel, "--rollup"])).byFidelity[SC]
    .netInput;

function seed17(m: Checkout, c: Case): void {
  sc(m, c, "c17-session-a", "c17-a1", "2026-05-10T10:00:00.000Z", 100);
  sc(m, c, "c17-session-a", "c17-a2", "2026-05-10T11:00:00.000Z", 300);
  sc(m, c, "c17-session-a", "c17-a3", "2026-05-10T12:00:00.000Z", 500);
  sc(m, c, "c17-session-b", "c17-b1", "2026-05-31T23:00:00.000Z", 700);
  sc(m, c, "c17-session-b", "c17-b2", "2026-06-01T01:00:00.000Z", 900);
}

describe(
  "Case 17: period placement of a straddling session (delta-01 R43-R48, R50)",
  {
    skip: SKIP_POSIX,
  },
  () => {
    let c: Case;
    before(() => {
      c = fresh();
      seed17(co, c);
    });
    test("--period 2026-05/2026-06 --rollup: sums 0.0015 / 0.0027, counts 1, priced/unpriced 1|0|1|0", () => {
      const p = priceSc(co, c, "--period", "2026-05");
      const n = priceSc(co, c, "--period", "2026-06");
      assert.ok(approx(p.sum, 0.0015) && p.count === 1);
      assert.ok(approx(n.sum, 0.0027) && n.count === 1);
      assert.equal(
        `${p.pricedCount}|${p.unpricedCount}|${n.pricedCount}|${n.unpricedCount}`,
        "1|0|1|0",
      );
    });
    test("--session rollups: A = 0.0015, B = 0.0027; R46 P + P+1 = 0.0042 = A + B", () => {
      const a = priceSc(co, c, "--session", "c17-session-a").sum;
      const b = priceSc(co, c, "--session", "c17-session-b").sum;
      assert.ok(approx(a, 0.0015) && approx(b, 0.0027));
      const periods =
        priceSc(co, c, "--period", "2026-05").sum + priceSc(co, c, "--period", "2026-06").sum;
      assert.ok(approx(periods, a + b) && approx(periods, 0.0042));
    });
    for (const [month, sum, tok] of [
      ["2026-05", 0.0015, 500],
      ["2026-06", 0.0027, 900],
    ] as const) {
      test(`R47 --period ${month}: usage-price = dashboard (amount ${sum}) and usage-query = dashboard = ${tok} tokens`, () => {
        const p = priceSc(co, c, "--period", month);
        const d = dashSc(co, c, month);
        assert.ok(approx(d.amount, p.sum));
        assert.equal(`${d.priced}|${d.unpriced}`, `${p.pricedCount}|${p.unpricedCount}`);
        assert.equal(d.net, tok);
        assert.equal(queryNet(co, c, month), tok);
      });
    }
    test("MUTATION RED: a filter-first rollupInput() counts B's 700-token snapshot in 2026-05 (0.0036)", () => {
      const needle = "if (!opts.period || opts.undrained || opts.pending) return";
      onMutant("scripts/lib/usage-store/query.js", needle, "return", (m, mc) => {
        seed17(m, mc);
        const sum = priceSc(m, mc, "--period", "2026-05").sum;
        assert.ok(!approx(sum, 0.0015) && approx(sum, 0.0036));
      });
    });
    test("R48 after pruning 2026-06: 05 sum 0.0036 count 2 priced 2, dashboard agrees (1200 tokens)", () => {
      const k = fresh();
      seed17(co, k);
      assert.equal(entry(co, k, "usage-prune", ["claude-code", "2026-06", "--force"]).status, 0);
      const p = priceSc(co, k, "--period", "2026-05");
      assert.ok(approx(p.sum, 0.0036) && p.count === 2);
      const d = dashSc(co, k, "2026-05");
      assert.ok(approx(d.amount, p.sum));
      assert.equal(`${p.pricedCount}|${p.unpricedCount}`, "2|0");
      assert.equal(`${d.priced}|${d.unpriced}`, "2|0");
      assert.equal(d.net, 1200);
    });
  },
);

describe(
  "Case 18: a superseded snapshot contributes nothing (delta-01 R44)",
  { skip: SKIP_POSIX },
  () => {
    test("05 count|priced|unpriced 0|0|0 sum 0; 06 count 1 unpriced 1 priced 0; dashboard agrees (R47)", () => {
      const c = fresh();
      sc(co, c, "c18-session-c", "c18-c1", "2026-05-20T10:00:00.000Z", 200);
      sc(
        co,
        c,
        "c18-session-c",
        "c18-c2",
        "2026-06-02T10:00:00.000Z",
        600,
        "totally-unresolvable-model-xyz",
      );
      const p = priceSc(co, c, "--period", "2026-05");
      assert.equal(`${p.count}|${p.pricedCount}|${p.unpricedCount}`, "0|0|0");
      assert.ok(approx(p.sum, 0));
      const n = priceSc(co, c, "--period", "2026-06");
      assert.equal(`${n.count}|${n.unpricedCount}`, "1|1");
      assert.equal(n.pricedCount, 0);
      const dp = dashSc(co, c, "2026-05");
      const dn = dashSc(co, c, "2026-06");
      assert.equal(
        `${dp.priced}|${dp.unpriced}|${dn.priced}|${dn.unpriced}`,
        `${p.pricedCount}|${p.unpricedCount}|${n.pricedCount}|${n.unpricedCount}`,
      );
    });
  },
);

// Case 19 of the Bash suite, first group (the second one is the conversion suite).
describe(
  "Case 19 (task-key): --period + --task-key rollup agrees with the dashboard (#1205)",
  {
    skip: SKIP_POSIX,
  },
  () => {
    test("05 = K2 300 (0.0009), 06 = K1 400 (0.0012); count = priced = 1; dashboard and query agree", () => {
      const c = fresh();
      sc(co, c, "c19-session-k1", "c19-k1a", "2026-05-20T10:00:00.000Z", 200);
      sc(co, c, "c19-session-k1", "c19-k1b", "2026-06-02T10:00:00.000Z", 400);
      sc(co, c, "c19-session-k2", "c19-k2a", "2026-05-12T10:00:00.000Z", 300);
      sc(co, c, "c19-session-o1", "c19-o1a", "2026-05-15T10:00:00.000Z", 1000);
      sc(co, c, "c19-session-o2", "c19-o2a", "2026-06-05T10:00:00.000Z", 800);
      for (const s of ["c19-session-k1", "c19-session-k2"]) {
        const r = entry(co, c, "usage-attribute", [
          "add",
          "--session",
          s,
          "--task-key",
          "c19-task",
          "--reason",
          `usage-pricing suite: Case 19 attributes ${s} to c19-task`,
          "--author",
          "test-suite",
        ]);
        assert.equal(r.status, 0);
      }
      for (const [month, want, tok] of [
        ["2026-05", 0.0009, 300],
        ["2026-06", 0.0012, 400],
      ] as const) {
        const p = priceSc(co, c, "--period", month, "--task-key", "c19-task");
        assert.ok(approx(p.sum, want), `${month} sum ${p.sum}`);
        assert.equal(`${p.count}|${p.pricedCount}|${p.unpricedCount}`, "1|1|0");
        const d = dashSc(co, c, month, "--task-key", "c19-task");
        assert.ok(approx(d.amount, p.sum));
        assert.equal(`${d.priced}|${d.unpriced}`, `${p.pricedCount}|${p.unpricedCount}`);
        assert.equal(d.net, tok);
        assert.equal(queryNet(co, c, month, "--task-key", "c19-task"), tok);
      }
    });
  },
);

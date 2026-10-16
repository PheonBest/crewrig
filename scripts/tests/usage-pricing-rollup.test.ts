// usage-pricing-rollup.test.ts — Cases 11/12, 13 and 16 of the pricing engine (spec
// 0260, row J1a; replaces the matching groups of test-usage-pricing.sh). Mutants edit
// a temp copy of the libraries only; a missing needle throws, so a refactor can never
// silently disarm an oracle. Dropped on purpose: every "X is restored after Case N"
// assert. Dates are fixed (no clock). Cases 17-19 live in usage-pricing-rollup-period.

/* oxlint-disable typescript/no-explicit-any, typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-return, typescript/no-unsafe-argument -- the entries emit untyped JSON */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { SKIP_POSIX } from "./lib/worktree-fixtures.ts";
import { onMutant, put } from "./lib/usage-pricing-case-kit.ts";
import {
  driverJson,
  entry,
  makeCheckout,
  pinnedCase,
  type Case,
  type Checkout,
} from "./lib/usage-pricing-rig.ts";

const INSTANT = "2026-05-15T10:00:00.000Z";
const PERIOD = "2026-05";
const lines = (...l: string[]): string => l.join("\n");

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

const rollup = (m: Checkout, c: Case, period: string): any =>
  driverJson(m, c, "rollup", [period, "claude-code"]);

// --- Case 11 / 12 — one snapshot (R32) and the mixed marker (R33) ---------------
describe(
  "Case 11/12: session-cumulative one snapshot (R32) + mixed marker (R33/0209)",
  {
    skip: SKIP_POSIX,
  },
  () => {
    const seed = (m: Checkout, c: Case): void => {
      const base = { requestInstant: INSTANT, modelId: "claude-sonnet-5" };
      put(m, c, "c11-r1", { ...base, session: "c11-per-request-session", idemKey: "c11-k1" });
      const sc = { ...base, fidelity: "session-cumulative", session: "c11-cumulative-session" };
      put(m, c, "c11-r2", { ...sc, idemKey: "c11-k2" });
      put(m, c, "c11-r3", { ...sc, idemKey: "c11-k3" });
    };
    test("Case 11: session-cumulative bucket contributes exactly one snapshot, not both", () => {
      const c = fresh();
      seed(co, c);
      assert.equal(rollup(co, c, PERIOD).byFidelity["session-cumulative"].count, 1);
    });
    test("Case 12: the combined total carries mixed [per-request, session-cumulative]", () => {
      const c = fresh();
      seed(co, c);
      assert.deepEqual(rollup(co, c, PERIOD).combined.mixed, ["per-request", "session-cumulative"]);
    });
    test("MUTATION RED (Case 11): session-cumulative now sums both snapshots (count=2)", () => {
      const needle = "'session-cumulative': lastSnapshots(captured),";
      const repl =
        "'session-cumulative': captured.filter((r) => r.fidelity === 'session-cumulative'),";
      onMutant("scripts/lib/usage-store/rollup.js", needle, repl, (m, c) => {
        seed(m, c);
        assert.equal(rollup(m, c, PERIOD).byFidelity["session-cumulative"].count, 2);
      });
    });
    test("MUTATION RED (Case 12): dropping the mixed key removes it from the combined total", () => {
      const needle = "result.combined = { sum, unpricedCount, unconvertedCount, mixed };";
      onMutant(
        "scripts/lib/usage-price/rollup.js",
        needle,
        "result.combined = { sum, unpricedCount, unconvertedCount };",
        (m, c) => {
          seed(m, c);
          assert.equal(Object.hasOwn(rollup(m, c, PERIOD).combined, "mixed"), false);
        },
      );
    });
  },
);

// --- Case 13 — unpriced is never counted as a zero-cost record (R34) ------------
describe("Case 13: unpriced never counted as zero (R34)", { skip: SKIP_POSIX }, () => {
  const seed = (m: Checkout, c: Case): void => {
    put(m, c, "c13-priced", {
      session: "c13-priced-session",
      idemKey: "c13-k1",
      requestInstant: INSTANT,
    });
    put(m, c, "c13-unpriced", {
      session: "c13-unpriced-session",
      idemKey: "c13-k2",
      requestInstant: INSTANT,
      modelId: "totally-unresolvable-model-xyz",
    });
  };
  const at = (m: Checkout, c: Case): any => rollup(m, c, PERIOD).byFidelity["per-request"];
  test("the unpriced record is tallied separately (count 2, unpricedCount 1)", () => {
    const c = fresh();
    seed(co, c);
    const b = at(co, c);
    assert.equal(b.count, 2);
    assert.equal(b.unpricedCount, 1);
  });
  test("MUTATION RED: the unpriced record is counted as a zero-cost priced record (unpricedCount 0)", () => {
    const needle = lines(
      "      if (cls === 'unpriced') {",
      "        unpricedCount += 1;",
      "      } else if (cls === 'unconverted') {",
      "        unconvertedCount += 1;",
      "      } else {",
      "        pricedCount += 1;",
      "        sum += price.amount;",
      "      }",
    );
    const repl = lines(
      "      if (false && cls === 'unpriced') {",
      "        unpricedCount += 1;",
      "      } else if (cls === 'unconverted') {",
      "        unconvertedCount += 1;",
      "      } else {",
      "        pricedCount += 1;",
      "        sum += price.amount || 0;",
      "      }",
    );
    onMutant("scripts/lib/usage-price/rollup.js", needle, repl, (m, c) => {
      seed(m, c);
      assert.equal(at(m, c).unpricedCount, 0);
    });
  });
});

// --- Case 16 — an uncaptured record in a --period selection (R34, #1194) --------
describe(
  "Case 16: uncaptured record in a --period selection (R34, #1194)",
  { skip: SKIP_POSIX },
  () => {
    const seed = (m: Checkout, c: Case): Record<string, any>[] => [
      put(m, c, "c16-captured", {
        session: "c16-captured-session",
        idemKey: "c16-k1",
        requestInstant: INSTANT,
      }),
      put(m, c, "c16-uncaptured", {
        kind: "uncaptured",
        session: "c16-uncaptured-session",
        idemKey: "c16-k2",
        requestInstant: INSTANT,
        uncapturedReason: "c16: transcript unavailable",
      }),
    ];
    const price = (m: Checkout, c: Case, ...more: string[]) =>
      entry(m, c, "usage-price", ["--period", PERIOD, "--cli", "claude-code", ...more]);
    const files = (dir: string, name: string): string[] => {
      const out: string[] = [];
      const walk = (d: string): void => {
        if (!fs.existsSync(d)) return;
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          if (e.isDirectory()) walk(path.join(d, e.name));
          else if (e.name === name) out.push(path.join(d, e.name));
        }
      };
      walk(dir);
      return out;
    };
    test("--period over a captured + an uncaptured record: rc 0, 2 JSONL lines, marked lines, stores, rollup", () => {
      const c = fresh();
      const [captured, uncaptured] = seed(co, c);
      const before = price(co, c, "--rollup").stdout;
      const r = price(co, c);
      const out = r.stdout.split("\n").filter(Boolean);
      assert.equal(r.status, 0);
      assert.equal(out.length, 2);
      const byId = (id: string): any =>
        out.map((l) => JSON.parse(l)).find((o) => o.recordId === id);
      const cap = byId(captured["recordId"]);
      assert.ok(
        typeof cap.amount === "number" && cap.amount > 0 && !cap.uncaptured && !cap.unpriced,
      );
      const unc = byId(uncaptured["recordId"]);
      assert.equal(unc.uncaptured, true);
      assert.equal(unc.kind, "uncaptured");
      assert.equal(unc.amount, null);
      assert.equal(unc.amountUsd, null);
      assert.equal(Object.hasOwn(unc, "unpriced"), false);
      assert.equal(unc.resolution.step, "uncaptured");
      const prices = path.join(c.root, "prices");
      assert.deepEqual(files(prices, `${uncaptured["recordId"]}.price.json`), []);
      assert.equal(files(prices, `${captured["recordId"]}.price.json`).length, 1);
      const after = price(co, c, "--rollup").stdout;
      const roll = JSON.parse(after);
      assert.equal(roll.uncapturedCount, 1);
      assert.equal(roll.combined.unpricedCount, 0);
      assert.equal(roll.byFidelity["per-request"].count, 1);
      assert.equal(after, before);
    });
    test("MUTATION RED: dropping the uncaptured guard sends the record into model-id resolution (toLowerCase)", () => {
      const needle = "if (record.kind !== 'captured') return uncapturedMarker(record, currency);";
      onMutant("scripts/lib/usage-price/store.js", needle, "", (m, c) => {
        seed(m, c);
        const r = price(m, c, "--no-store");
        assert.notEqual(r.status, 0);
        assert.ok(r.stderr.includes("toLowerCase"), "stderr does not name toLowerCase");
      });
    });
  },
);

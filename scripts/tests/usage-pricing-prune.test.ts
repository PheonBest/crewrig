// usage-pricing-prune.test.ts — Cases 14 (14a/14b/14c) and 15 of the pricing engine
// (spec 0260, row J1a; replaces the matching groups of test-usage-pricing.sh): the
// end-to-end prune over the REAL two-store registry (attribution-ledger + price-store).
// Mutants edit a temp copy of usage-store/prune.js only; a missing needle throws.
// Dropped on purpose: every "prune.js is restored after Mutation N" assert.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { SKIP_POSIX } from "./lib/worktree-fixtures.ts";
import { onMutant, put } from "./lib/usage-pricing-case-kit.ts";
import {
  driver,
  entry,
  makeCheckout,
  pinnedCase,
  writeJson,
  type Case,
  type Checkout,
} from "./lib/usage-pricing-rig.ts";

// The ledger partitions by the entry timestamp (the clock), so the period is the current UTC month.
const INSTANT = new Date().toISOString();
const PERIOD = INSTANT.slice(0, 7);
const PRUNE = "scripts/lib/usage-store/prune.js";
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

function fresh(): Case {
  const c = pinnedCase(co);
  cases.push(c);
  return c;
}

const hasFiles = (dir: string, ok: (name: string) => boolean): boolean =>
  fs.existsSync(dir) && fs.readdirSync(dir).some(ok);

/** Store one record, price it, and attribute the period: the two-store fixture. */
function seedTwoStores(m: Checkout, c: Case, tag: string): void {
  const record = put(m, c, `${tag}-record`, {
    session: `${tag}-session`,
    idemKey: `${tag}-key`,
    modelId: "claude-sonnet-5",
    requestInstant: INSTANT,
  });
  const r = driver(m, c, "price-record", [writeJson(c, `${tag}-price-in.json`, record)]);
  assert.equal(r.status, 0);
  const a = entry(m, c, "usage-attribute", [
    "add",
    "--period",
    PERIOD,
    "--cli",
    "claude-code",
    "--task-key",
    `usage-pricing-${tag}-task`,
    "--reason",
    `Prune scenario ${tag}`,
    "--author",
    "test-suite",
  ]);
  assert.equal(a.status, 0);
}

const prune = (m: Checkout, c: Case): string => {
  const r = entry(m, c, "usage-prune", ["claude-code", PERIOD, "--force"]);
  assert.equal(r.status, 0);
  return r.stdout;
};

const priceDir = (c: Case): string => path.join(c.root, "prices", "claude-code", PERIOD);
const ledgerDir = (c: Case): string => path.join(c.root, "ledger", PERIOD);

// Case 14 — end-to-end prune reaches BOTH registered derived stores (R37, delta-01 R31/R33)
describe(
  "Case 14: end-to-end prune, two registered stores (R37 + delta-01 R31/R33)",
  {
    skip: SKIP_POSIX,
  },
  () => {
    test("Case 14: journal, price file and ledger entry exist; after the prune both partitions are gone, marker present, report names both stores", () => {
      const c = fresh();
      seedTwoStores(co, c, "c14");
      const journal = path.join(c.root, "journal", "claude-code", PERIOD);
      assert.ok(hasFiles(journal, (n) => n.endsWith(".json") && !n.endsWith(".wing.json")));
      assert.ok(hasFiles(priceDir(c), (n) => n.endsWith(".price.json")));
      assert.ok(hasFiles(ledgerDir(c), (n) => n.endsWith(".json")));
      const out = prune(co, c);
      assert.equal(fs.existsSync(priceDir(c)), false);
      assert.equal(fs.existsSync(ledgerDir(c)), false);
      assert.ok(fs.existsSync(path.join(c.root, "pruned", "claude-code", `${PERIOD}.json`)));
      assert.match(out, /attribution-ledger: [1-9]/);
      assert.match(out, /price-store: [1-9]/);
    });

    test("MUTATION 14a RED: a total no-op walk names no store at all", () => {
      onMutant(
        PRUNE,
        "for (const store of layout.derivedStores()) {",
        "for (const store of []) {",
        (m, c) => {
          seedTwoStores(m, c, "c14a");
          const out = prune(m, c);
          assert.doesNotMatch(out, /attribution-ledger/i);
          assert.doesNotMatch(out, /price-store/i);
        },
      );
    });

    test("MUTATION 14b RED: skipping the period arm leaves the ledger surviving and unreported, price-store still runs", () => {
      const needle = lines("if (store.scope === 'period') {", "      dir = store.dirFor(per);");
      const repl = lines(
        "if (store.scope === 'period' && false) {",
        "      dir = store.dirFor(per);",
      );
      onMutant(PRUNE, needle, repl, (m, c) => {
        seedTwoStores(m, c, "c14b");
        const out = prune(m, c);
        assert.doesNotMatch(out, /attribution-ledger/i);
        assert.ok(fs.existsSync(ledgerDir(c)) && fs.readdirSync(ledgerDir(c)).length > 0);
        assert.match(out, /price-store: [1-9]/);
      });
    });

    test("MUTATION 14c RED: skipping the cli-period arm leaves the price partition surviving and unreported, attribution-ledger still runs", () => {
      const needle = lines(
        "} else if (store.scope === 'cli-period') {",
        "      dir = store.dirFor(cli, per);",
      );
      const repl = lines(
        "} else if (store.scope === 'cli-period' && false) {",
        "      dir = store.dirFor(cli, per);",
      );
      onMutant(PRUNE, needle, repl, (m, c) => {
        seedTwoStores(m, c, "c14c");
        const out = prune(m, c);
        assert.doesNotMatch(out, /price-store/i);
        assert.ok(fs.existsSync(priceDir(c)));
        assert.match(out, /attribution-ledger: [1-9]/);
      });
    });
  },
);

// Case 15 — no registered store holds anything: no store is named (delta-01 R32/R33)
describe(
  "Case 15: no registered store holds anything (delta-01 R32/R33)",
  { skip: SKIP_POSIX },
  () => {
    const seed = (m: Checkout, c: Case, tag: string): void => {
      put(m, c, `${tag}-record`, {
        session: `${tag}-session`,
        idemKey: `${tag}-key`,
        requestInstant: INSTANT,
      });
    };
    test("neither store is named and '1 record(s) removed' proceeds as before the delta", () => {
      const c = fresh();
      seed(co, c, "c15");
      const out = prune(co, c);
      assert.doesNotMatch(out, /attribution-ledger/i);
      assert.doesNotMatch(out, /price-store/i);
      assert.ok(out.includes("1 record(s) removed"), "report lacks '1 record(s) removed'");
    });
    test("MUTATION 15 RED: both empty stores are falsely named in the report with removed 0", () => {
      const needle = lines(
        "    let storeNames;",
        "    try {",
        "      storeNames = fs.readdirSync(dir);",
        "    } catch (err) {",
        "      continue; // nothing recorded for this store at this period",
        "    }",
      );
      const repl = lines(
        "    let storeNames;",
        "    try {",
        "      storeNames = fs.readdirSync(dir);",
        "    } catch (err) {",
        "      storeReports.push({ id: store.id, removed: 0 });",
        "      continue;",
        "    }",
      );
      onMutant(PRUNE, needle, repl, (m, c) => {
        seed(m, c, "c15m");
        const out = prune(m, c);
        assert.match(out, /attribution-ledger: 0/);
        assert.match(out, /price-store: 0/);
      });
    });
  },
);

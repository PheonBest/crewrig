// usage-dashboard-crosscheck.test.ts — cases 13.3, 13.5 and 13.8 of the usage dashboard suite (spec 0210
// R26-R30; replaces the matching groups of test-usage-dashboard.sh, spec 0260 row J1a): the dashboard
// agrees with spec 0209's usage-price and usage-query rollups through the explicit mapping (13.3, 13.8),
// and unconverted prices never enter a sum (13.5). Every case works on its own copy of the golden root
// under a temp HOME, and a before/after check proves nothing was written under that HOME.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import {
  dash,
  drv,
  expected,
  FIXTURES,
  freshSandbox,
  homeMarker,
  manifest,
  PRICING,
  runEntry,
  threeForms,
  type Sandbox,
} from "./lib/usage-dashboard-rig.ts";
import { formsB, startServer } from "./lib/usage-dashboard-serve.ts";
import {
  cross0209,
  partition,
  tokensEq,
  type QueryRollup,
  type Rollup0209,
} from "./lib/usage-dashboard-checks.ts";
import { firstDiff, normRecomputed, parseView, type View } from "./lib/usage-dashboard-views.ts";
import { cleanupAll, realTmp } from "./lib/worktree-fixtures.ts";

const homes: Sandbox[] = [];
const sandbox = (kind: "golden" | "empty" = "golden"): Sandbox => {
  const sb = freshSandbox(kind);
  homes.push(sb);
  return sb;
};
after(() => {
  const dirty = homes.flatMap((sb) => homeMarker(sb.home));
  cleanupAll();
  assert.deepEqual(dirty, [], "no case wrote under its temp HOME's .crewrig/usage");
});

const report = (sb: Sandbox, args: string[]): View => {
  const r = dash(["report", "--json", ...args], sb);
  assert.equal(r.status, 0, `report --json ${args.join(" ")} exits 0: ${r.stderr.slice(0, 200)}`);
  const v = parseView(r.stdout);
  assert.deepEqual(partition(v).errs.slice(0, 8), [], `13.4 partition of ${args.join(" ")}`);
  return v;
};
const rollup0209 = (sb: Sandbox, key: string, currency?: string): Rollup0209 =>
  JSON.parse(drv("rollup0209", currency ? [key, currency] : [key], sb.env)) as Rollup0209;

describe("13.3 spec 0209 cross-check through the explicit mapping (v1-F5, v2-F3)", () => {
  for (const key of ["task-mixed", "task-split-b"]) {
    test(`13.3 [${key}] totals.price maps onto usage-price rollup() per fidelity and combined (no count row)`, () => {
      const sb = sandbox();
      assert.deepEqual(
        cross0209(report(sb, ["--task-key", key, "--currency", "USD"]), rollup0209(sb, key)),
        [],
      );
    });
    test(`13.3 [${key} XXX] unconverted records map onto usage-price rollup() per fidelity and combined, outside every sum`, () => {
      const sb = sandbox();
      const r = rollup0209(sb, key, "XXX");
      assert.deepEqual(cross0209(report(sb, ["--task-key", key, "--currency", "XXX"]), r), []);
      assert.ok(
        r.combined.unconvertedCount > 0 && r.combined.sum === 0,
        `combined: ${JSON.stringify(r.combined)}`,
      );
    });
    test(`13.3 [${key}] tasks[${key}].tokens equals usage:query --task-key ${key} --rollup --combined`, () => {
      const sb = sandbox();
      const q = runEntry("usage-query", ["--task-key", key, "--rollup", "--combined"], sb);
      assert.equal(q.status, 0, q.stderr.slice(0, 200));
      const task = report(sb, []).tasks.find((t) => t.taskHandoffKey === key);
      assert.deepEqual(tokensEq(task, JSON.parse(q.stdout) as QueryRollup, `tasks[${key}]`), []);
    });
  }
  test("13.3 tasks[] are per-key passes: task-split-a = 400, task-split-b = 2400 (ledger {period} split)", () => {
    const v = report(sandbox(), []);
    const net = (k: string): number | undefined =>
      v.tasks.find((t) => t.taskHandoffKey === k)?.tokens.byFidelity["session-cumulative"]
        ?.netInput;
    assert.equal(
      net("task-split-a"),
      expected("splitTasks", "task-split-a", "sessionCumulativeNetInput"),
    );
    assert.equal(
      net("task-split-b"),
      expected("splitTasks", "task-split-b", "sessionCumulativeNetInput"),
    );
  });
});

describe("13.5 unconverted prices never enter a sum (v1-F2)", () => {
  test("13.5a priced 1, unconverted 1, amount = A's stored EUR amount in A, B and C; four renderings agree; reads leave the root unchanged", async () => {
    const sb = sandbox("empty");
    drv("pin-only", [PRICING], sb.env);
    drv("seed-fx", [PRICING], sb.env);
    drv("write-one", [path.join(FIXTURES, "records-unconverted", "ua-stored-eur.json")], sb.env);
    const priced = runEntry("usage-price", ["--session", "sess-eur-a", "--currency", "EUR"], sb);
    assert.equal(priced.status, 0, priced.stderr.slice(0, 200));
    fs.rmSync(path.join(sb.root, "fx"), { recursive: true, force: true });
    drv("write-one", [path.join(FIXTURES, "records-unconverted", "ub-no-fixing.json")], sb.env);
    const id = (
      JSON.parse(
        fs.readFileSync(path.join(FIXTURES, "records-unconverted", "ua-stored-eur.json"), "utf8"),
      ) as { recordId: string }
    ).recordId;
    const stored = JSON.parse(drv("stored-amount", [sb.root, id], sb.env)) as {
      amount: number;
      currency: string;
      status: string;
    } | null;
    assert.ok(
      stored !== null && stored.status === "ok" && stored.currency === "EUR",
      `13.5a setup: record A is stored in EUR with status ok: ${JSON.stringify(stored)}`,
    );
    const before = manifest(sb.root);
    const server = await startServer(sb);
    try {
      const out = realTmp("ud-unconv-");
      const f = threeForms(sb, out, "unconv", ["--currency", "EUR"]);
      const b = await formsB(server, ["--currency", "EUR"]);
      assert.deepEqual([...f.errors, ...b.errors], [], "13.5a every form yields a view model");
      for (const [form, v] of [
        ["A", f.A!],
        ["B", b.B!],
        ["C", f.C!],
      ] as const) {
        const p = v.totals.price;
        assert.deepEqual(
          [p.pricedCount, p.unconvertedCount, p.amount === stored.amount],
          [1, 1, true],
          `13.5a form ${form}: priced 1, unconverted 1, amount = A's stored EUR amount exactly (B's USD figure excluded)`,
        );
        assert.deepEqual(partition(v).errs.slice(0, 8), []);
      }
      for (const other of [f.C!, b.B!, b.Bv!])
        assert.equal(
          firstDiff(normRecomputed(f.A!), normRecomputed(other)),
          null,
          "13.5a the four renderings agree (recomputed)",
        );
    } finally {
      const stopped = await server.stop();
      assert.equal(stopped.viaStop, true);
    }
    assert.equal(
      manifest(sb.root),
      before,
      "13.5a the store: false reads leave the root unchanged",
    );
  });

  test("13.5b --currency XXX: priced 0, unconverted >= 1, amount null, absent no-converted-price", () => {
    const p = report(sandbox(), ["--currency", "XXX"]).totals.price;
    assert.deepEqual(
      [p.pricedCount === 0, p.unconvertedCount >= 1, p.amount === null, p.absent],
      [true, true, true, "no-converted-price"],
    );
  });
});

interface Rolled {
  byFidelity: Record<
    string,
    { netInput: number; sum: number; pricedCount: number; unpricedCount: number }
  >;
}
const rolled = (sb: Sandbox, entry: string, period: string): Rolled["byFidelity"][string] => {
  const r = runEntry(entry, ["--period", period, "--rollup"], sb);
  assert.equal(r.status, 0, r.stderr.slice(0, 200));
  return (JSON.parse(r.stdout) as Rolled).byFidelity["session-cumulative"]!;
};

describe("13.8 --period agreement with usage-query and usage-price (spec 0209 delta-01 R47, R45)", () => {
  for (const m of ["2026-09", "2026-10"]) {
    test(`13.8 --period ${m}: usage:query --rollup = usage:price --rollup = dashboard (tokens, amount, priced, unpriced)`, () => {
      const sb = sandbox();
      const dsh = report(sb, ["--period", m]).totals;
      const dTok = dsh.tokens.byFidelity["session-cumulative"]!.netInput;
      const dPrice = dsh.price.byFidelity["session-cumulative"]!;
      const want = (k: string): number => expected("periodAgreement", m, k);
      assert.equal(
        rolled(sb, "usage-query", m).netInput,
        want("sessionCumulativeNetInput"),
        `13.8 --period ${m}: usage:query --rollup`,
      );
      assert.equal(
        dTok,
        want("sessionCumulativeNetInput"),
        `13.8 --period ${m}: usage:query --rollup = dashboard = ${want("sessionCumulativeNetInput")} session-cumulative tokens`,
      );
      const qp = rolled(sb, "usage-price", m);
      for (const amount of [qp.sum, dPrice.amount!])
        assert.ok(
          Math.abs(amount - want("sessionCumulativeAmount")) <= 1e-12,
          `13.8 --period ${m}: usage:price --rollup = dashboard (amount ${want("sessionCumulativeAmount")})`,
        );
      assert.deepEqual(
        [qp.pricedCount, dPrice.pricedCount],
        [want("pricedCount"), want("pricedCount")],
      );
      assert.deepEqual(
        [qp.unpricedCount, dPrice.unpricedCount],
        [want("unpricedCount"), want("unpricedCount")],
      );
    });
  }
  for (const [key, m] of [
    ["task-split-a", "2026-10"],
    ["task-split-b", "2026-11"],
  ] as const) {
    test(`13.8 R45 --task-key ${key} --period ${m}: session-cumulative equals the selection, ledger applied, filters before the choice`, () => {
      const v = report(sandbox(), ["--task-key", key, "--period", m]);
      assert.equal(
        v.totals.tokens.byFidelity["session-cumulative"]!.netInput,
        expected("periodAgreement", "split", key, "sessionCumulativeNetInput"),
      );
    });
  }
});

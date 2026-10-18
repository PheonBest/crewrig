// usage-dashboard-buckets.test.ts — cases 13.6 and 13.7 of the usage dashboard suite (spec 0210 R26-R30;
// replaces the matching groups of test-usage-dashboard.sh, spec 0260 row J1a): the buckets partition the
// totals (sums, ISO weeks, month keys, the hand-derived whole-store figures) and every bucket equals the
// view filtered to it (placement equality, bounded read vs whole-store read), with S1's superseded day.
// The ~30 filtered `report --json` runs are async children, six at a time.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { sums, isoWeekBounds, isoWeekKey, lastDayOfMonth } from "./lib/usage-dashboard-checks.ts";
import { FIXTURES, freshSandbox, REPO, type Sandbox } from "./lib/usage-dashboard-rig.ts";
import {
  findEntry,
  groupDiff,
  parseView,
  FIDS,
  type Entry,
  type Group,
  type View,
} from "./lib/usage-dashboard-views.ts";
import { cleanupAll } from "./lib/worktree-fixtures.ts";

const sb: Sandbox = freshSandbox();
interface Expected {
  isoWeekW53: { recordCount: number; perRequestNetInput: number };
  months: string[];
  wholeStore: {
    recordCount: number;
    capturedCount: number;
    uncapturedCount: number;
    pricedCount: number;
    unpricedCount: number;
    tokens: Record<string, Record<string, number>>;
    perRequestCacheWrite: unknown;
  };
}
interface Rec {
  timing: { requestInstant: string };
  modelId?: string | null;
  provenance: { cli: string };
}
const EXP = JSON.parse(fs.readFileSync(path.join(FIXTURES, "expected.json"), "utf8")) as Expected;

/** `report --json <filters>` of the golden sandbox as an async child. */
function report(filters: readonly string[]): Promise<View> {
  return new Promise((resolve, reject) => {
    const c = spawn(
      process.execPath,
      [
        "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
        path.join(REPO, "scripts", "usage-dashboard.ts"),
        "report",
        "--json",
        ...filters,
      ],
      { env: sb.env, cwd: REPO, stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    c.stdout.on("data", (d: Buffer) => (out += d.toString()));
    c.stderr.on("data", (d: Buffer) => (err += d.toString()));
    c.on("close", () => {
      try {
        resolve(parseView(out));
      } catch {
        reject(new Error(`report --json ${filters.join(" ")}: no view (${err.slice(0, 200)})`));
      }
    });
  });
}

/** Run the jobs with at most `n` in flight; resolves to one error string per failing job. */
async function bounded(jobs: (() => Promise<string | null>)[], n = 6): Promise<string[]> {
  const errs: string[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < jobs.length) {
        const e = await jobs[next++]!().catch((x: unknown) => String(x));
        if (e) errs.push(e);
      }
    }),
  );
  return errs;
}

const records = fs
  .readdirSync(path.join(FIXTURES, "records"))
  .filter((n) => n.endsWith(".json"))
  .map((n) => JSON.parse(fs.readFileSync(path.join(FIXTURES, "records", n), "utf8")) as Rec);
const uniq = (xs: string[]): string[] => [...new Set(xs)].sort();
const days = uniq(records.map((r) => String(r.timing.requestInstant).slice(0, 10)));

let whole: View;
before(async () => {
  whole = await report([]);
});
after(() => cleanupAll());

describe("13.6 buckets partition the totals", () => {
  test("13.6 report --json yields a view model and Σ day = Σ week = Σ month = Σ byCli = Σ byModel = totals, per fidelity, keys ascending", () => {
    assert.deepEqual(sums(whole), []);
  });

  test("13.6 2026-12-31 and 2027-01-01 both land in ISO week 2026-W53", () => {
    assert.equal(isoWeekKey("2026-12-31"), "2026-W53");
    assert.equal(isoWeekKey("2027-01-01"), "2026-W53");
    const e = whole.byBucket.week.find((x) => x.key === "2026-W53");
    assert.ok(e, "2026-W53 bucket absent");
    assert.equal(e.recordCount, EXP.isoWeekW53.recordCount);
    assert.equal(e.tokens.byFidelity["per-request"]!.netInput, EXP.isoWeekW53.perRequestNetInput);
  });

  test("13.6 month keys are the UTC months holding a placed record", () => {
    assert.equal(whole.byBucket.month.map((e) => e.key).join(" "), EXP.months.join(" "));
  });

  test("13.6 whole-store totals equal the hand-derived expected.json figures", () => {
    const t = whole.totals;
    const w = EXP.wholeStore;
    const classes = ["netInput", "cacheRead", "output", "reasoning"] as const;
    const flat = (tokens: (f: string) => Record<string, number>): string[] =>
      FIDS.map((f) => classes.map((k) => tokens(f)[k]).join("/"));
    assert.deepEqual(
      [
        t.recordCount,
        t.capturedCount,
        t.uncapturedCount,
        t.price.pricedCount,
        t.price.unpricedCount,
        ...flat((f) => t.tokens.byFidelity[f] as unknown as Record<string, number>),
        JSON.stringify(t.tokens.byFidelity["per-request"]!.cacheWrite),
      ],
      [
        w.recordCount,
        w.capturedCount,
        w.uncapturedCount,
        w.pricedCount,
        w.unpricedCount,
        ...flat((f) => w.tokens[f]!),
        JSON.stringify(w.perRequestCacheWrite),
      ],
    );
  });
});

describe("13.7 placement equality (v1-F4)", () => {
  test("13.7 every day, ISO week, month (--period and --from/--to), model and CLI bucket equals the view filtered to it", async () => {
    type Job = [string, string[], (v: View) => Entry[] | undefined, string];
    const jobs: Job[] = [];
    for (const d of days)
      jobs.push([`day ${d}`, ["--from", d, "--to", d], (v) => v.byBucket.day, d]);
    for (const d of days) {
      const [mon, sun] = isoWeekBounds(d);
      const w = isoWeekKey(d);
      if (!jobs.some((j) => j[0] === `week ${w}`))
        jobs.push([`week ${w}`, ["--from", mon, "--to", sun], (v) => v.byBucket.week, w]);
    }
    for (const m of uniq(days.map((d) => d.slice(0, 7)))) {
      jobs.push([`month ${m} (--period)`, ["--period", m], (v) => v.byBucket.month, m]);
      jobs.push([
        `month ${m} (--from/--to)`,
        ["--from", `${m}-01`, "--to", lastDayOfMonth(m)],
        (v) => v.byBucket.month,
        m,
      ]);
    }
    for (const k of uniq(records.filter((r) => r.modelId).map((r) => String(r.modelId))))
      jobs.push([`model ${k}`, ["--model", k], (v) => v.byModel, k]);
    for (const k of uniq(records.map((r) => String(r.provenance.cli))))
      jobs.push([`cli ${k}`, ["--cli", k], (v) => v.byCli, k]);
    const errs = await bounded(
      jobs.map(([label, filters, pick, key]) => async () => {
        const v = await report(filters);
        const d = groupDiff(findEntry(pick(whole), key) as Group | undefined, v.totals);
        return d === null ? null : `${label}: ${d}`;
      }),
    );
    assert.ok(jobs.length > 20, `views: ${jobs.length}`);
    assert.deepEqual(errs.slice(0, 12), []);
  });

  test("13.7 inside --from 2026-09-18 --to 2026-10-06, each day bucket equals the unfiltered one", async () => {
    const ranged = await report(["--from", "2026-09-18", "--to", "2026-10-06"]);
    const inside = days.filter((d) => /^2026-09-|^2026-10-0[1-6]/.test(d));
    assert.ok(inside.length > 0);
    for (const d of inside)
      assert.equal(
        groupDiff(
          findEntry(whole.byBucket.day, d) as Group | undefined,
          findEntry(ranged.byBucket.day, d) as Group | undefined,
        ),
        null,
        `day ${d}`,
      );
  });

  test("13.7 S1: byBucket.day has no 2026-09-20 entry, 2026-09-21 = 500 session-cumulative", () => {
    assert.equal(findEntry(whole.byBucket.day, "2026-09-20"), undefined);
    const e = findEntry(whole.byBucket.day, "2026-09-21") as Group | undefined;
    assert.equal(e?.tokens.byFidelity["session-cumulative"]?.netInput, 500);
  });

  test("13.7 S1: 2026-W38 gets nothing from S1", () => {
    const e = findEntry(whole.byBucket.week, "2026-W38") as Group | undefined;
    assert.equal(e ? e.tokens.byFidelity["session-cumulative"]!.netInput : 0, 0);
  });

  test("13.7 S1: --from 2026-09-20 --to 2026-09-20 gives zero and the superseded-only empty state (v2-F1)", async () => {
    const v = await report(["--from", "2026-09-20", "--to", "2026-09-20"]);
    assert.deepEqual(
      [v.empty, v.totals.recordCount, v.totals.tokens.combined.netInput],
      ["superseded-only", 0, 0],
    );
  });
});

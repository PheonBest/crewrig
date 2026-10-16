// usage-dashboard-agreement.test.ts — cases 13.1, 13.2 and 13.4 of the usage dashboard suite (spec 0210
// R26-R30; replaces the matching groups of test-usage-dashboard.sh, spec 0260 row J1a): the four
// renderings of one view agree (A page JSON, B page, B /view.json, C --json), every `data-k` cell equals
// format(value), a price statement follows every price, form C parses back, the tallies are explicit,
// and D3's partition identities hold in every view produced. The read-only marker of the temp HOME is
// checked at the end; the server is torn down through POST /stop and its child handle.

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { checkCells } from "./lib/usage-dashboard-cells.ts";
import { checkText } from "./lib/usage-dashboard-text.ts";
import {
  dash,
  expected,
  freshSandbox,
  homeMarker,
  REPO,
  threeForms,
  type Forms,
} from "./lib/usage-dashboard-rig.ts";
import {
  formsB,
  formToken,
  startServer,
  type FormsB,
  type Server,
} from "./lib/usage-dashboard-serve.ts";
import { extractEmbedded, partition } from "./lib/usage-dashboard-checks.ts";
import {
  firstDiff,
  normRecomputed,
  normVolatile,
  parseView,
  type View,
} from "./lib/usage-dashboard-views.ts";
import { cleanupAll, realTmp } from "./lib/worktree-fixtures.ts";

const sb = freshSandbox();
const out = realTmp("ud-agree-");
let server: Server;
const seen: [string, View][] = [];

before(async () => {
  server = await startServer(sb);
});
after(async () => {
  const stopped = await server.stop();
  cleanupAll();
  assert.equal(stopped.viaStop, true, "POST /stop ends the server with exit 0 and no orphan child");
  assert.deepEqual(homeMarker(sb.home), [], "the temp HOME's .crewrig/usage stays empty");
});

const noMissing = (label: string, f: Forms, b?: FormsB): void =>
  assert.deepEqual(
    [...f.errors, ...(b?.errors ?? [])],
    [],
    `13.1 [${label}] every form yields a view model`,
  );
const record = (label: string, ...views: (View | undefined)[]): void => {
  for (const v of views) if (v) seen.push([label, v]);
};

async function agreement(
  label: string,
  mode: "volatile" | "recomputed",
  filters: string[],
): Promise<{ f: Forms; b: FormsB }> {
  const f = threeForms(sb, out, label, filters);
  const b = await formsB(server, filters);
  noMissing(label, f, b);
  const { A, C, B, Bv } = { ...f, ...b };
  record(label, A, C, B, Bv);
  const norm = mode === "recomputed" ? normRecomputed : normVolatile;
  for (const other of [C!, B!, Bv!]) {
    assert.equal(
      firstDiff(norm(A!), norm(other)),
      null,
      `13.1 [${label}] A, B page, B /view.json and C --json are deep-equal (${mode})`,
    );
  }
  for (const [form, html, view] of [
    ["A", f.Ahtml, A!],
    ["B", b.Bhtml, B!],
  ] as const) {
    const r = checkCells(html, view);
    assert.deepEqual(
      r.errs,
      [],
      `13.1/13.2 [${label}] form ${form}: every data-k cell equals format(value), a statement follows every price`,
    );
  }
  const t = checkText(f.Ctext, C!, mode);
  assert.deepEqual(
    t.errs,
    [],
    `13.1/13.2 [${label}] form C rows parse back to the view model, a note: line follows every price`,
  );
  return { f, b };
}

describe("13.1/13.2 the renderings of one view agree", () => {
  test("13.1 [whole] A, B, Bv and C agree; cells, statements and rows check out", async () => {
    await agreement("whole", "volatile", []);
  });
  test("13.1 [mixed] --task-key task-mixed", async () => {
    await agreement("mixed", "volatile", ["--task-key", "task-mixed"]);
  });
  test("13.1 [ranged] --from --to --model", async () => {
    await agreement("ranged", "volatile", [
      "--from",
      "2026-10-01",
      "--to",
      "2026-10-31",
      "--model",
      "claude-sonnet-5",
    ]);
  });
  test("13.1 [eur] priced in EUR with unconvertedCount 0 (recomputed)", async () => {
    const { f } = await agreement("eur", "recomputed", ["--currency", "EUR"]);
    assert.equal(
      f.C!.totals.price.unconvertedCount,
      0,
      "13.1 [eur] priced in EUR with unconvertedCount 0",
    );
    assert.equal(f.C!.totals.price.currency, "EUR");
  });
  test("13.1 [xxx] --currency XXX (recomputed)", async () => {
    await agreement("xxx", "recomputed", ["--currency", "XXX"]);
  });

  test("13.1 model.js exports NORMALISE_VOLATILE / NORMALISE_RECOMPUTED matching their definition", () => {
    const model = createRequire(import.meta.url)(
      path.join(REPO, "scripts/lib/usage-dashboard/model.js"),
    ) as Record<string, unknown>;
    const v = parseView(dash(["report", "--json"], sb).stdout);
    for (const [name, mine] of [
      ["NORMALISE_VOLATILE", normVolatile],
      ["NORMALISE_RECOMPUTED", normRecomputed],
    ] as const) {
      const theirs = model[name];
      assert.equal(typeof theirs, "function", `model.js does not export ${name} as a function`);
      assert.equal(
        firstDiff(mine(v), (theirs as (x: View) => View)(structuredClone(v))),
        null,
        `${name} disagrees with the suite's normaliser`,
      );
    }
  });

  test("13.1 two USD runs over a primed store agree exactly, computedAt included", () => {
    const a = parseView(dash(["report", "--json"], sb).stdout);
    const c = parseView(dash(["report", "--json"], sb).stdout);
    assert.equal(firstDiff(normVolatile(a), normVolatile(c)), null);
  });

  test("13.1 [aot] page --as-of-today, report --json --as-of-today and B POST /recompute are deep-equal (recomputed)", async () => {
    const f = threeForms(sb, out, "aot", ["--as-of-today"]);
    const token = formToken((await server.get("/")).body);
    const r = await server.post("/recompute", `token=${token}`);
    assert.equal(r.status, 200, `recompute status ${r.status}`);
    const B = extractEmbedded(r.body);
    assert.deepEqual(f.errors, [], "13.1 [aot] A, C and B POST /recompute each yield a view model");
    record("aot", f.A, f.C, B);
    for (const other of [f.C!, B])
      assert.equal(firstDiff(normRecomputed(f.A!), normRecomputed(other)), null);
    assert.deepEqual(
      checkCells(f.Ahtml, f.A!).errs,
      [],
      "13.1/13.2 [aot] form A: every data-k cell equals format(value)",
    );
    assert.deepEqual(
      checkCells(r.body, B).errs,
      [],
      "13.1/13.2 [aot] form B: every data-k cell equals format(value)",
    );
    assert.deepEqual(
      checkText(f.Ctext, f.C!, "recomputed").errs,
      [],
      "13.1/13.2 [aot] form C rows parse back to the view model",
    );
  });
});

describe("13.4 tallies and partition (R8, R27, R4)", () => {
  test("13.4 [gaps] forms A, B, C: uncaptured 1, unpriced 1, both counted apart from the sums; sum 0.00045 USD", async () => {
    const f = threeForms(sb, out, "gaps", ["--session", "sess-gaps"]);
    const b = await formsB(server, ["--session", "sess-gaps"]);
    noMissing("gaps", f, b);
    record("gaps", f.A, f.C, b.B);
    const g = (k: string): number => expected("gapsScope", k);
    for (const [form, v] of [
      ["A", f.A!],
      ["B", b.B!],
      ["C", f.C!],
    ] as const) {
      const t = v.totals;
      const got = [
        t.recordCount,
        t.capturedCount,
        t.uncapturedCount,
        t.price.pricedCount,
        t.price.unpricedCount,
        t.price.unconvertedCount,
        t.tokens.combined.netInput,
        t.tokens.combined.output,
      ];
      const want = [
        "recordCount",
        "capturedCount",
        "uncapturedCount",
        "pricedCount",
        "unpricedCount",
        "unconvertedCount",
        "combinedNetInput",
        "combinedOutput",
      ].map(g);
      assert.deepEqual(
        got,
        want,
        `13.4 [gaps] form ${form}: uncaptured 1, unpriced 1, both counted apart from the sums`,
      );
      assert.ok(
        Math.abs(t.price.amount! - g("amountUsd")) < 1e-12,
        `13.4 [gaps] form ${form}: price sum is the priced record alone (0.00045 USD)`,
      );
    }
  });

  test("13.4 [clean] forms A, B, C: uncaptured 0 and unpriced 0 are explicit zeros, in their own data-k cells", async () => {
    const f = threeForms(sb, out, "clean", ["--session", "sess-alpha"]);
    const b = await formsB(server, ["--session", "sess-alpha"]);
    noMissing("clean", f, b);
    record("clean", f.A, f.C, b.B);
    for (const [form, v] of [
      ["A", f.A!],
      ["B", b.B!],
      ["C", f.C!],
    ] as const) {
      assert.deepEqual(
        [v.totals.uncapturedCount, v.totals.price.unpricedCount],
        [0, 0],
        `13.4 [clean] form ${form}: uncaptured 0 and unpriced 0 are explicit zeros`,
      );
    }
    for (const [form, html] of [
      ["A", f.Ahtml],
      ["B", b.Bhtml],
    ] as const) {
      assert.match(
        html,
        /data-k="totals\.uncapturedCount"[^>]*>\s*0\s*</,
        `13.4 [clean] form ${form} renders the zero counts in their own data-k cells`,
      );
      assert.match(
        html,
        /data-k="totals\.price\.unpricedCount"[^>]*>\s*0\s*</,
        `13.4 [clean] form ${form} renders the zero counts in their own data-k cells`,
      );
    }
  });

  test("13.4 [no priced record] amount null, absent no-priced-record (R4), em dash in form C", async () => {
    const filters = ["--model", "vendorless-model-zz"];
    const f = threeForms(sb, out, "nopriced", filters);
    const b = await formsB(server, filters);
    noMissing("nopriced", f, b);
    record("nopriced", f.A, f.C, b.B);
    for (const [form, v] of [
      ["A", f.A!],
      ["B", b.B!],
      ["C", f.C!],
    ] as const) {
      const p = v.totals.price;
      assert.equal(p.amount, null, `13.4 [no priced record] form ${form}: amount null`);
      assert.equal(
        p.absent,
        "no-priced-record",
        `13.4 [no priced record] form ${form}: absent no-priced-record (R4)`,
      );
      assert.equal(p.unpricedCount, 1);
    }
    assert.ok(
      f.Ctext.includes("—") && f.Ctext.includes("no-priced-record"),
      "13.4 [no priced record] form C prints an em dash with the absence reason",
    );
  });

  test("13.4 partition identities hold in every view the file produced (priced+unpriced+unconverted = captured)", () => {
    assert.ok(seen.length >= 20, `views recorded: ${seen.length}`);
    for (const [label, v] of seen) {
      const p = partition(v);
      assert.deepEqual(p.errs.slice(0, 8), [], `13.4 partition [${label}]`);
    }
  });
});

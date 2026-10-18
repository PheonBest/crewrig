// usage-attribution-period-rollup.test.ts — delta-01 of test-usage-attribution.sh (spec 0260
// groups D01-19..D01-25; Bash L698-856; spec 0209 delta-01 R43-R46, issues #1193 and #1205).
// One root holds the nine fixtures and one ledger entry (every 2026-06 record moves to
// d01-task-b); the queries run through `scripts/usage-query.ts`.

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { cleanupAll } from "./lib/worktree-fixtures.ts";
import {
  type Case,
  cli,
  driver,
  fixture,
  listLines,
  newCase,
  realTmp,
} from "./lib/usage-attribution-rig.ts";

let c: Case;

function query(...args: string[]): string {
  const out = cli(c, "query", args);
  assert.equal(out.status, 0, out.stderr);
  return out.stdout;
}

/** `<session-cumulative netInput>,<per-request netInput>,<uncapturedCount>` of a rollup. */
function fig(out: string): string {
  const v = JSON.parse(out) as {
    byFidelity: Record<string, { netInput: number }>;
    uncapturedCount: number;
  };
  return [
    v.byFidelity["session-cumulative"].netInput,
    v.byFidelity["per-request"].netInput,
    v.uncapturedCount,
  ].join(",");
}

const sc = (out: string): number =>
  (JSON.parse(out) as { byFidelity: Record<string, { netInput: number }> }).byFidelity[
    "session-cumulative"
  ].netInput;

/** `<count>:<session>/<netInput>/<month>,...` of a listing (ports `d01_lines`). */
function lines(...args: string[]): string {
  const out = cli(c, "query", args).stdout;
  const rows = listLines(out).map((l) => {
    const r = JSON.parse(l) as {
      identity: { sessionId: string };
      tokens?: { netInput: number };
      timing: { requestInstant: string };
    };
    return [
      r.identity.sessionId,
      r.tokens ? r.tokens.netInput : "u",
      r.timing.requestInstant.slice(0, 7),
    ].join("/");
  });
  return `${rows.length}:${rows.sort().join(",")}`;
}

describe("usage attribution period rollup (delta-01)", () => {
  before(() => {
    c = newCase();
    const cwd = realTmp("usage-attr-nogit-");
    const store = (f: string, extra: Record<string, string> = {}) => {
      const out = driver(c, ["submit", fixture(`${f}.json`)], { ATTR_CTX_CWD: cwd, ...extra });
      assert.match(out.stdout, /"status":"stored"/, `delta-01 fixture ${f}: ${out.stdout}`);
    };
    for (const f of [
      "d01-session-a-sc-1",
      "d01-session-a-sc-2",
      "d01-session-a-sc-3",
      "d01-session-b-sc-1",
      "d01-session-b-sc-2",
      "d01-session-d-per-request",
      "d01-session-d-uncaptured",
    ]) {
      store(f);
    }
    for (const f of ["d01-session-c-sc-1", "d01-session-c-sc-2"]) {
      store(f, { ATTR_CTX_ENV_CREWRIG_TASK: "d01-task-a" });
    }
    const add = cli(c, "attribute", [
      "add",
      "--period",
      "2026-06",
      "--task-key",
      "d01-task-b",
      "--reason",
      "usage-attribution suite: delta-01 moves every 2026-06 record to d01-task-b",
      "--author",
      "test-suite",
    ]);
    assert.equal(add.status, 0, add.stderr);
  });
  after(() => cleanupAll());

  test("D01-19 May rollup chooses before placing: session-cumulative 500", () => {
    // filter-first would give 1600
    assert.equal(sc(query("--period", "2026-05", "--rollup")), 500);
  });

  test("D01-19 May rollup: no later-month per-request or uncaptured leak", () => {
    assert.equal(fig(query("--period", "2026-05", "--rollup")).slice(4), "0,0");
  });

  test("D01-20 June rollup: 1500 (B 900 + C 600), 50, 1", () => {
    assert.equal(fig(query("--period", "2026-06", "--rollup")), "1500,50,1");
  });

  test("D01-21 May --cli claude-code rollup: 500", () => {
    assert.equal(sc(query("--period", "2026-05", "--cli", "claude-code", "--rollup")), 500);
  });

  test("D01-21 May --fidelity session-cumulative rollup: 500", () => {
    const out = query("--period", "2026-05", "--fidelity", "session-cumulative", "--rollup");
    assert.equal(sc(out), 500);
  });

  test("D01-22 plain listing reads one partition: 5 lines, all 2026-05", () => {
    const rows = listLines(query("--period", "2026-05")).map(
      (l) => (JSON.parse(l) as { timing: { requestInstant: string } }).timing.requestInstant,
    );
    assert.equal(rows.length, 5);
    assert.ok(rows.every((r) => r.startsWith("2026-05")));
  });

  test("D01-23 --task-key d01-task-a rollup: 400", () => {
    assert.equal(sc(query("--task-key", "d01-task-a", "--rollup")), 400);
  });

  test("D01-23 --task-key d01-task-b rollup: 1500", () => {
    assert.equal(sc(query("--task-key", "d01-task-b", "--rollup")), 1500);
  });

  // D01-24 composed selectors (#1205): a selector narrows --period, never replaces it
  test("D01-24 listing --period 2026-05 --session d01-session-b: only the May record", () => {
    assert.equal(
      lines("--period", "2026-05", "--session", "d01-session-b"),
      "1:d01-session-b/700/2026-05",
    );
  });

  test("D01-24 listing --period 2026-06 --task-key d01-task-a --no-ledger: C's own June record", () => {
    assert.equal(
      lines("--period", "2026-06", "--task-key", "d01-task-a", "--no-ledger"),
      "1:d01-session-c/600/2026-06",
    );
  });

  test("D01-24 listing --period 2026-06 --task-key d01-task-a: nothing (ledger moved it)", () => {
    assert.equal(lines("--period", "2026-06", "--task-key", "d01-task-a"), "0:");
  });

  test("D01-24 listing --period 2026-06 --task-key d01-task-b: four June rows (ledger first)", () => {
    assert.equal(
      lines("--period", "2026-06", "--task-key", "d01-task-b"),
      "4:d01-session-b/900/2026-06,d01-session-c/600/2026-06,d01-session-d/50/2026-06,d01-session-d/u/2026-06",
    );
  });

  // D01-25 rollups under a selection (R45); wrong figures: 500 key ignored, 0 choose-then-filter
  test("D01-25 May + d01-task-a: 400 under taskHandoffKey d01-task-a", () => {
    const out = query("--period", "2026-05", "--task-key", "d01-task-a", "--rollup");
    assert.equal(sc(out), 400);
    assert.equal((JSON.parse(out) as { taskHandoffKey: string }).taskHandoffKey, "d01-task-a");
  });

  const figs: ReadonlyArray<readonly [string, readonly string[], string]> = [
    [
      "May + d01-task-a --no-ledger",
      ["--period", "2026-05", "--task-key", "d01-task-a", "--no-ledger"],
      "0,0,0",
    ],
    ["June + d01-task-b (pin)", ["--period", "2026-06", "--task-key", "d01-task-b"], "1500,50,1"],
    ["May + d01-task-b (R46)", ["--period", "2026-05", "--task-key", "d01-task-b"], "0,0,0"],
    [
      "May + session d01-session-a (pin)",
      ["--period", "2026-05", "--session", "d01-session-a"],
      "500,0,0",
    ],
    ["May + session d01-session-b", ["--period", "2026-05", "--session", "d01-session-b"], "0,0,0"],
  ];
  for (const [name, args, want] of figs) {
    test(`D01-25 rollup under selection: ${name}`, () => {
      assert.equal(fig(query(...args, "--rollup")), want);
    });
  }
});

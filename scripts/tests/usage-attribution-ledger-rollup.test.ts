// usage-attribution-ledger-rollup.test.ts — R26..R29 of test-usage-attribution.sh (spec 0260
// groups R26-14, R27-15, R27-16, R28-17, R29-18; Bash L475-695). Each group has its own usage
// root, scratch HOME and palace path (`newCase`); the queries run through `scripts/usage-query.ts`.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import { cleanupAll } from "./lib/worktree-fixtures.ts";
import {
  buildCheckout,
  type Case,
  cli,
  driver,
  fixture,
  journalPath,
  newCase,
  realTmp,
  recordId,
  rollupFig,
  walkFiles,
} from "./lib/usage-attribution-rig.ts";

function submit(c: Case, rec: string, extra: Record<string, string | undefined> = {}) {
  const out = driver(c, ["submit", fixture(`${rec}.json`)], extra);
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /"status":"stored"/, `${rec} did not store: ${out.stdout}`);
  return JSON.parse(out.stdout) as { period: string; cli: string; recordId: string };
}

function ledger(c: Case, session: string, key: string, reason: string) {
  const entry = {
    scope: { session },
    timestamp: new Date().toISOString(),
    author: "test-suite",
    reason,
    taskHandoffKey: key,
  };
  const out = driver(c, ["ledger-append", JSON.stringify(entry)]);
  assert.equal(out.status, 0, out.stderr);
}

function query(c: Case, ...args: string[]): string {
  const out = cli(c, "query", args);
  assert.equal(out.status, 0, out.stderr);
  return out.stdout;
}

describe("usage attribution ledger and rollups (R26-R29)", () => {
  after(() => cleanupAll());

  test("R26-14 the ledger wins at read time and never rewrites the journal", () => {
    const c = newCase();
    const stored = submit(c, "r26-record", { ATTR_CTX_ENV_CREWRIG_TASK: "capture-time-key" });
    const entry = journalPath(c.root, "claude-code", stored.period, stored.recordId);
    const sha = (): string => driver(c, ["sha256-file", entry]).stdout.trim();
    const before = sha();
    assert.match(before, /^[0-9a-f]{64}$/);
    ledger(c, "attr-r26-session", "ledger-time-key", "R26 ledger-key override probe");
    const withLedger = query(c, "--session", "attr-r26-session");
    const without = query(c, "--session", "attr-r26-session", "--no-ledger");
    assert.ok(withLedger.includes('"taskHandoffKey":"ledger-time-key"'), withLedger);
    assert.ok(without.includes('"taskHandoffKey":"capture-time-key"'), without);
    assert.equal(sha(), before, "R26: journal entry changed after the ledger override");
  });

  describe("R27 rollups", () => {
    const c = newCase();
    const files = [
      "r27-per-request-1",
      "r27-per-request-2",
      "r27-run-total-1",
      "r27-session-cumulative-1",
      "r27-session-cumulative-2",
      "r27-session-cumulative-3",
      "r27-uncaptured-1",
    ];
    let rollup = "";

    test("R27-15 rollup sums per fidelity", () => {
      for (const f of files) submit(c, f, { ATTR_CTX_ENV_CREWRIG_TASK: "attr-r27-task" });
      rollup = query(c, "--task-key", "attr-r27-task", "--rollup");
      assert.equal(rollupFig(rollup, "per-request"), 300);
      assert.equal(rollupFig(rollup, "run-total"), 500);
      // last snapshot only: never the sum of three (6000) or a delta
      assert.equal(rollupFig(rollup, "session-cumulative"), 3000);
      assert.equal((JSON.parse(rollup) as { uncapturedCount: number }).uncapturedCount, 1);
      assert.ok(!rollup.includes('"mixed"'), `mixed without --combined: ${rollup}`);
    });

    test("R27-15 --combined mixed names the contributing fidelities", () => {
      const combined = query(c, "--task-key", "attr-r27-task", "--rollup", "--combined");
      const mixed = JSON.stringify(
        (JSON.parse(combined) as { combined: { mixed: unknown } }).combined.mixed,
      );
      for (const f of ["per-request", "run-total", "session-cumulative"]) {
        assert.ok(mixed.includes(f), `${f} missing from ${mixed}`);
      }
    });

    test("R27-16 capture failure record is attributed and counted", () => {
      const journalDir = path.join(c.root, "journal", "claude-code");
      const entries = (): string[] =>
        walkFiles(journalDir).filter((f) => !/\.(wing|attr)\.json$/.test(f));
      const beforeList = entries();
      const task = "attr-r27-failure-task";
      const asTranscript = realTmp("usage-attr-transcript-");
      const out = driver(
        c,
        ["capture-throw", "claude-code", asTranscript, realTmp("usage-attr-cwd-")],
        { ATTR_CTX_ENV_CREWRIG_TASK: task, CREWRIG_TASK: task },
      );
      assert.equal(out.status, 0, out.stderr);
      const added = entries().filter((f) => !beforeList.includes(f));
      assert.equal(added.length, 1, `new entries: ${added.join(",")}`);
      const file = path.join(journalDir, added[0]);
      const text = fs.readFileSync(file, "utf8");
      assert.ok(text.includes("capture threw"), "entry names the throw");
      assert.ok(text.includes('"kind":"uncaptured"'), "entry is uncaptured");
      assert.ok(text.includes(`"attribution":{"taskHandoffKey":"${task}"}`), text);
      const doc = JSON.parse(text) as { timing: { requestInstant: string } };
      const side = path.join(path.dirname(file), `${path.basename(file, ".json")}.attr.json`);
      assert.ok(fs.existsSync(side), `sidecar missing: ${side}`);
      assert.ok(doc.timing.requestInstant.length >= 7);
      assert.ok(fs.readFileSync(side, "utf8").includes('"channel":"env"'));
      const failure = JSON.parse(query(c, "--task-key", task, "--rollup")) as {
        uncapturedCount: number;
      };
      assert.equal(failure.uncapturedCount, 1);
    });
  });

  test("R28-17 root override: nothing under HOME, files under the relocated root", () => {
    const c = newCase();
    const cwd = realTmp("usage-attr-nogit-");
    const decl = driver(c, [
      "declaration-write",
      JSON.stringify({
        taskHandoffKey: "r28-decl-key",
        declaringChannel: "explicit",
        sessionId: "attr-r28-session",
      }),
    ]);
    assert.equal(decl.status, 0, decl.stderr);
    submit(c, "r28-record", { ATTR_CTX_CWD: cwd });
    ledger(c, "attr-r28-session", "r28-ledger-key", "R28 root-override probe");
    query(c, "--session", "attr-r28-session", "--rollup");
    assert.deepEqual(walkFiles(path.join(c.home, ".crewrig", "usage")), [], "wrote under HOME");
    // strengthened: the Bash condition was vacuous (`A && B && C || D`, D always true)
    const declFiles = walkFiles(path.join(c.root, "declarations"));
    const ledgerFiles = walkFiles(path.join(c.root, "ledger"));
    assert.ok(declFiles.length >= 1, `declarations: ${declFiles.length}`);
    assert.ok(ledgerFiles.length >= 1, `ledger: ${ledgerFiles.length}`);
    const doc = query(c, "--task-key", "r28-ledger-key", "--rollup");
    assert.ok(doc.includes("netInput"), doc);
    const perRequest = (JSON.parse(doc) as { byFidelity: Record<string, object> }).byFidelity[
      "per-request"
    ];
    assert.ok("netInput" in perRequest, doc);
  });

  test("R29-18 cross-CLI identity: one attribution, one combined rollup", () => {
    const c = newCase();
    const dir = path.join(realTmp("usage-attr-syn-"), "r29-checkout");
    buildCheckout(dir, "fix/0920-cross-cli-identity", "git@github.com:crewrig/crewrig.git");
    const names = ["r29-claude-code", "r29-gemini-cli", "r29-subagent"];
    const attrs = names.map((n) => {
      const st = submit(c, n, { ATTR_CTX_CWD: dir });
      assert.equal(st.recordId, recordId(fixture(`${n}.json`)));
      const side = journalPath(c.root, st.cli, st.period, st.recordId, ".attr");
      const doc = JSON.parse(fs.readFileSync(side, "utf8")) as { attribution: unknown };
      return JSON.stringify(doc.attribution);
    });
    assert.notEqual(attrs[0], "null");
    assert.equal(attrs[1], attrs[0]);
    assert.equal(attrs[2], attrs[0]);
    const key = (JSON.parse(attrs[0]) as { taskHandoffKey: string }).taskHandoffKey;
    const combined = query(c, "--task-key", key, "--rollup");
    assert.equal(rollupFig(combined, "per-request"), 666, "111+222+333");
  });
});

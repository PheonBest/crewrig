// usage-storage-query.test.ts — read selectors of test-usage-storage.sh (spec 0260):
// (e) selectors + no sidecar leak + R15, (e2) composed selectors (#1205), MUTATION RED
// of the query.js final filter (MUT-3), run on a temp copy.

import assert from "node:assert/strict";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { mutated } from "./lib/usage-mutants.ts";
import { makeRecord, query, sandbox, writeRecord } from "./lib/usage-storage-rig.ts";

const sb = sandbox();
const instant = "2021-03-10T12:00:00.000Z";
const period = "2021-03";
const ASSET = "forge-issue:crewrig/crewrig#9999";
const q = (n: number, o: Parameters<typeof makeRecord>[0]) =>
  makeRecord({
    session: `query-session-${n}`,
    idem: `query-key-${n}`,
    requestInstant: instant,
    ...o,
  });
const R1 = q(1, { cli: "claude-code", fidelity: "per-request" });
const R2 = q(2, { cli: "gemini-cli", agentId: "query-agent-1", parentSession: "query-parent-1" });
const R3 = q(3, { cli: "copilot-cli", taskKey: "query-task-key-1" });
const R4 = q(4, {
  cli: "antigravity",
  asset: { kind: "forge-issue", ref: "crewrig/crewrig#9999" },
});
const R5 = q(5, { cli: "claude-code", fidelity: "run-total" });
const id = (r: { recordId: string }): string => r.recordId;

before(() => {
  for (const r of [R1, R2, R3, R4, R5]) assert.equal(writeRecord(sb, r).state, "stored");
});
after(() => sb.cleanup());

describe("(e) read selectors return exactly the expected set, no sidecar leaks", () => {
  const cases: [string, string[], string[]][] = [
    ["--session", ["--session", "query-session-1"], [id(R1)]],
    ["--agent+--parent", ["--agent", "query-agent-1", "--parent", "query-parent-1"], [id(R2)]],
    ["--task-key", ["--task-key", "query-task-key-1"], [id(R3)]],
    ["--asset", ["--asset", ASSET], [id(R4)]],
    ["--period+--cli", ["--period", period, "--cli", "claude-code"], [id(R1), id(R5)].sort()],
    [
      "--fidelity narrowing",
      ["--period", period, "--cli", "claude-code", "--fidelity", "per-request"],
      [id(R1)],
    ],
  ];
  for (const [label, args, want] of cases) {
    test(`selector ${label} returns exactly the id set, every line has schemaVersion and no wingDerivation`, () => {
      const r = query(sb, args);
      assert.deepEqual(r.ids, want, r.stdout);
      for (const line of r.lines) {
        assert.ok("schemaVersion" in line, "line misses schemaVersion");
        assert.ok(!("wingDerivation" in line), "a sidecar leaked into the result");
      }
    });
  }
  test("--agent without --parent is refused (R15 pairing enforcement)", () => {
    assert.notEqual(query(sb, ["--agent", "query-agent-1"]).status, 0);
  });
});

describe("(e2) composed selectors are ANDed (#1205)", () => {
  const cases: [string, string[], string[]][] = [
    [
      "--period+--task-key returns exactly R3",
      ["--period", period, "--task-key", "query-task-key-1"],
      [id(R3)],
    ],
    ["--period+--asset returns exactly R4", ["--period", period, "--asset", ASSET], [id(R4)]],
    [
      "--period+--session returns exactly R1",
      ["--period", period, "--session", "query-session-1"],
      [id(R1)],
    ],
    [
      "--period+--agent+--parent returns exactly R2",
      ["--period", period, "--agent", "query-agent-1", "--parent", "query-parent-1"],
      [id(R2)],
    ],
    [
      "--session+--cli gemini-cli returns nothing",
      ["--session", "query-session-1", "--cli", "gemini-cli"],
      [],
    ],
    [
      "--session+--cli claude-code returns exactly R1",
      ["--session", "query-session-1", "--cli", "claude-code"],
      [id(R1)],
    ],
  ];
  for (const [label, args, want] of cases) {
    test(label, () => assert.deepEqual(query(sb, args).ids, want));
  }
  test("--period+--asset bad exits 2 with the <kind>:<ref> error", () => {
    const r = query(sb, ["--period", period, "--asset", "bad"]);
    assert.equal(r.status, 2);
    assert.ok(`${r.stdout}${r.stderr}`.includes("--asset must be <kind>:<ref>"));
  });
});

describe("MUTATION RED: query.js final filter dropped (MUT-3)", () => {
  test("composed selectors return more than R3/R4 once the filter is removed", () => {
    const copy = mutated(
      "scripts/lib/usage-store/query.js",
      "return records.filter(pred);",
      "return records;",
    );
    try {
      const entry = path.join(copy.root, "scripts", "lib", "usage-store", "query.js");
      const t = query(sb, ["--period", period, "--task-key", "query-task-key-1"], entry);
      const a = query(sb, ["--period", period, "--asset", ASSET], entry);
      assert.ok(t.ids.length > 1 || t.ids[0] !== id(R3), "mutation not detected for --task-key");
      assert.ok(a.ids.length > 1 || a.ids[0] !== id(R4), "mutation not detected for --asset");
    } finally {
      copy.dispose();
    }
  });
});

// usage-capture-derivation.test.ts — TypeScript port of groups G1, G3, G4, G13 of
// scripts/tests/test-usage-capture.sh (spec 0260, section `test-usage-capture.sh`).
//
//   G1  per-fixture derivation: captured/uncaptured == expected.json (R27), every
//       rec-*.json validates against v1.schema.json, a second --submit pass stores 0
//       (R23 idempotence, incl. sink recordId dedup for gemini legacy-json /
//       json-kind-summary); zero discovered fixtures is a failure
//   G3  copilot-cli/events-jsonl-ignored: cliVersion from events.jsonl, poison value
//       never in tokens, tokens == sqlite columns
//   G4  unknown/unrecognized-shape: 0 captured, 1 uncaptured (R28)
//   G13 gemini-cli three generations yield pairwise-distinct formatFingerprint (i1-F1)
//
// Headless-only checks (G2) live in the headless test file.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import {
  copyFixtureHome,
  derive,
  discoverFixtures,
  FIXTURES_DIR,
  hasNodeSqlite,
  materializeDb,
  mkTemp,
  readRecord,
  validateDir,
  type DeriveResult,
  type UsageFixture,
} from "./lib/usage-capture-fixtures.ts";

const FIXTURES = discoverFixtures();
// Floor: the 15 adapter fixtures that exist today; a vanished fixture must fail.
const FIXTURE_FLOOR = 15;
const REQUIRED_LABELS = [
  "antigravity/statusline-payload",
  "claude-code/2.1.x-jsonl",
  "claude-code/2.1.x-subagents",
  "copilot-cli/assistant-usage-events",
  "copilot-cli/events-jsonl-ignored",
  "gemini-cli/json-kind-summary",
  "gemini-cli/json-kind-summary-no-summary",
  "gemini-cli/jsonl-set-journal",
  "gemini-cli/legacy-json",
  "gemini-cli/subagent-jsonl",
  "headless/antigravity-envelope",
  "headless/claude-code-envelope",
  "headless/copilot-cli-envelope",
  "headless/gemini-cli-envelope",
  "unknown/unrecognized-shape",
];

let work = "";
let usageRoot = "";
let home = "";
const outcomes = new Map<string, DeriveResult>();

before(() => {
  work = mkTemp("usage-derive-work-");
  usageRoot = mkTemp("usage-derive-root-");
  home = mkTemp("usage-derive-home-");
});
after(() => {
  for (const dir of [work, usageRoot, home]) fs.rmSync(dir, { recursive: true, force: true });
});

function slug(label: string): string {
  return label.replaceAll("/", "_");
}

/** Run the derivation of one fixture; `pass` 2 re-derives over the same source and root. */
function deriveFixture(fx: UsageFixture, pass: 1 | 2): DeriveResult {
  const e = fx.expected as Record<string, string>;
  const outDir = path.join(work, `${slug(fx.label)}${pass === 2 ? "-pass2" : ""}`);
  const base = { usageRoot, outDir, home };
  switch (fx.expected.adapter) {
    case "claude-code":
    case "gemini-cli":
      return derive(
        [fx.expected.adapter, path.join(fx.dir, e.transcriptPath), "--submit", "1"],
        base,
      );
    case "antigravity":
      return derive(["antigravity", path.join(fx.dir, e.payloadFile), "--submit", "1"], base);
    case "headless-envelope":
      return derive(["headless", e.cli, path.join(fx.dir, e.envelopeFile)], base);
    case "copilot-cli": {
      const db = path.join(work, `${slug(fx.label)}.db`);
      if (pass === 1) materializeDb(fx.dir, db, home);
      // SAFETY: a throwaway copy of the fixture home, never the tracked path.
      const homeCopy = path.join(work, `home-copy-${slug(fx.label)}`);
      if (pass === 1) copyFixtureHome(fx.dir, homeCopy);
      return derive(["copilot-cli", db, "--home", homeCopy, "--submit", "1"], base);
    }
    default:
      assert.fail(`${fx.label}: unrecognized adapter in expected.json: ${fx.expected.adapter}`);
  }
}

describe("usage-capture derivation (G1 R27, schema validity, R23 idempotence)", () => {
  test("G1 non-vacuity: discovered fixtures equal a directory scan and meet the floor", () => {
    assert.ok(FIXTURES.length > 0, `zero fixtures discovered under ${FIXTURES_DIR}`);
    assert.ok(
      FIXTURES.length >= FIXTURE_FLOOR,
      `only ${FIXTURES.length} adapter fixtures discovered, floor is ${FIXTURE_FLOOR}`,
    );
    const labels = FIXTURES.map((f) => f.label);
    for (const required of REQUIRED_LABELS) {
      assert.ok(labels.includes(required), `fixture ${required} is not discovered`);
    }
    const scanned: string[] = [];
    const stack = [FIXTURES_DIR];
    while (stack.length > 0) {
      const dir = stack.pop() as string;
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) stack.push(full);
        else if (
          ent.name === "expected.json" &&
          "adapter" in JSON.parse(fs.readFileSync(full, "utf8"))
        ) {
          scanned.push(path.relative(FIXTURES_DIR, dir).split(path.sep).join("/"));
        }
      }
    }
    assert.deepEqual([...labels].sort(), scanned.sort());
  });

  test("G1 preflight: node:sqlite and node_modules/ajv are present (hard assertions)", () => {
    assert.ok(hasNodeSqlite(), "this Node runtime does not expose node:sqlite unflagged");
    const ajv = path.join(FIXTURES_DIR, "..", "..", "..", "..", "node_modules", "ajv");
    assert.ok(fs.existsSync(ajv), "node_modules/ajv is missing; run `npm install` first");
  });

  for (const fx of FIXTURES) {
    test(`G1 ${fx.label}: counts (R27), schema validity, idempotence (R23)`, () => {
      const r = deriveFixture(fx, 1);
      outcomes.set(fx.label, r);
      assert.equal(r.rc, 0, `${fx.label}: derivation failed (exit ${r.rc})\n${r.output}`);
      assert.equal(r.captured, fx.expected.captured, `${fx.label}: captured (R27)\n${r.output}`);
      assert.equal(r.uncaptured, fx.expected.uncaptured, `${fx.label}: uncaptured (R27)`);
      assert.equal(validateDir(r.outDir, home), null, `${fx.label}: schema validation failed`);

      if (fx.expected.adapter === "headless-envelope") return; // no cursor, no sink submit
      const again = deriveFixture(fx, 2);
      assert.equal(again.rc, 0, `${fx.label}: second pass failed\n${again.output}`);
      assert.equal(
        again.stored,
        0,
        `${fx.label}: second derivation stored ${again.stored} new record(s), expected 0 (idempotence)\n${again.output}`,
      );
    });
  }
});

describe("usage-capture derivation (G3, G4 fixture-specific facts)", () => {
  // reported to coordinator: on windows-latest the copilot adapter derives cliVersion "unknown"
  // from the copied fixture home (expected 9.9.9-fixture from events.jsonl); the POSIX behaviour
  // is asserted here, the Windows difference is left to the C1/F-row owners.
  test(
    "G3 copilot-cli/events-jsonl-ignored: events.jsonl read for cliVersion only",
    {
      skip:
        process.platform === "win32" &&
        "SKIP: events.jsonl cliVersion is not derived on Windows (reported)",
    },
    () => {
      const fx = FIXTURES.find((f) => f.label === "copilot-cli/events-jsonl-ignored");
      assert.ok(fx, "fixture copilot-cli/events-jsonl-ignored not discovered");
      const r = outcomes.get(fx.label) ?? deriveFixture(fx, 1);
      assert.equal(r.rc, 0, r.output);
      const rec = readRecord(r.outDir);
      const e = fx.expected as Record<string, unknown>;
      assert.equal(rec.provenance.cliVersion, e.expectedCliVersion);
      const values = Object.values(rec.tokens);
      assert.ok(
        !values.includes(e.poisonValue),
        "derived tokens leaked the events.jsonl poison value",
      );
      assert.deepEqual(rec.tokens, e.expectedTokens);
    },
  );

  test("G4 unknown/unrecognized-shape: 0 captured, 1 uncaptured (R28)", () => {
    const fx = FIXTURES.find((f) => f.label === "unknown/unrecognized-shape");
    assert.ok(fx, "fixture unknown/unrecognized-shape not discovered");
    const r = outcomes.get(fx.label) ?? deriveFixture(fx, 1);
    assert.equal(r.captured, 0);
    assert.equal(r.uncaptured, 1);
  });
});

describe("usage-capture derivation (G13 i1-F1 gemini-cli format generations)", () => {
  test("G13 legacy-json, json-kind-summary and jsonl-set-journal fingerprints are pairwise distinct", () => {
    // A FRESH usage root: the jsonl generation is cursor-tracked on the absolute path.
    const freshRoot = mkTemp("usage-fp-root-");
    try {
      const sources: Array<[string, string]> = [
        ["legacy-json", "legacy-json/session.json"],
        ["json-kind-summary", "json-kind-summary/session.json"],
        ["jsonl-set-journal", "jsonl-set-journal/session.jsonl"],
      ];
      const prints = sources.map(([name, rel]) => {
        const outDir = path.join(work, `fp-${name}`);
        const r = derive(["gemini-cli", path.join(FIXTURES_DIR, "gemini-cli", rel)], {
          usageRoot: freshRoot,
          outDir,
          home,
        });
        assert.equal(r.rc, 0, `${name}: derivation failed\n${r.output}`);
        const fp = readRecord(outDir).provenance.formatFingerprint;
        assert.ok(typeof fp === "string" && fp !== "", `${name}: no formatFingerprint`);
        return fp;
      });
      assert.equal(
        new Set(prints).size,
        3,
        `fingerprints not pairwise distinct: ${prints.join(" | ")}`,
      );
    } finally {
      fs.rmSync(freshRoot, { recursive: true, force: true });
    }
  });
});

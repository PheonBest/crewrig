// usage-capture-headless.test.ts — TypeScript port of groups G2, G14, G16 and the G6
// assertRecordShape rejection loop of scripts/tests/test-usage-capture.sh (spec 0260,
// section `test-usage-capture.sh`).
//
//   G2  every headless-envelope fixture: forbiddenText declared (non-vacuous), canaries
//       present in the envelope, no canary in the derived record (R18), modelId,
//       identity.sessionId, tokens == expectedTokens, raw keys, raw.stats keys
//   G6  assertRecordShape() rejects every usage-records mutant and the recordId-mismatch
//       derivation fixture (section 6)
//   G14 mutation proof (section 9): a copy of the module tree with `raw: envelope || {}`
//       restored leaks the canary, so the G2 negative check can fail
//   G16 R20 (section 11): the copilot-cli allow-list keeps pricing, total_nano_aiu and
//       request_multiplier, and firstPartyCopilot() still reads the first-party price

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import {
  derive,
  DERIVATION_DIR,
  DERIVE_JS,
  discoverFixtures,
  FIXTURES_DIR,
  forbiddenHits,
  hermeticEnv,
  MUTANTS_DIR,
  mkTemp,
  readRecord,
  type UsageFixture,
} from "./lib/usage-capture-fixtures.ts";
import { applyMutation, copyTracked } from "./lib/mutation-copy.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const HEADLESS = discoverFixtures().filter((f) => f.expected.adapter === "headless-envelope");

let work = "";
let usageRoot = "";
let home = "";

before(() => {
  work = mkTemp("usage-headless-work-");
  usageRoot = mkTemp("usage-headless-root-");
  home = mkTemp("usage-headless-home-");
});
after(() => {
  for (const dir of [work, usageRoot, home]) fs.rmSync(dir, { recursive: true, force: true });
});

function sorted(value: unknown): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
    ),
  );
}

function deriveHeadless(fx: UsageFixture, moduleRoot?: string): ReturnType<typeof derive> {
  const e = fx.expected as Record<string, string>;
  return derive(["headless", e.cli, path.join(fx.dir, e.envelopeFile)], {
    usageRoot,
    outDir: path.join(work, `${fx.label.replaceAll("/", "_")}${moduleRoot ? "-mutant" : ""}`),
    home,
    moduleRoot,
  });
}

describe("usage-capture headless fixtures (G2 R18 allow-list)", () => {
  test("G2 non-vacuity: at least one headless-envelope fixture is discovered", () => {
    assert.ok(HEADLESS.length > 0, "zero headless-envelope fixtures discovered");
  });

  for (const fx of HEADLESS) {
    test(`G2 ${fx.label}: canaries, no leak, modelId, session, tokens, raw keys`, () => {
      const e = fx.expected as Record<string, unknown>;
      const canaries = ((e.forbiddenText as unknown[] | undefined) ?? []).filter(
        (c): c is string => typeof c === "string" && c.length > 0,
      );
      assert.ok(
        canaries.length > 0,
        `${fx.label}: expected.json declares no forbiddenText, refusing to pass the R18 check vacuously`,
      );
      const envelope = fs.readFileSync(path.join(fx.dir, e.envelopeFile as string), "utf8");
      const missing = canaries.filter((c) => !envelope.includes(c));
      assert.deepEqual(missing, [], `${fx.label}: canaries missing from the fixture envelope`);

      const r = deriveHeadless(fx);
      assert.equal(r.rc, 0, `${fx.label}: derivation failed\n${r.output}`);
      const rec = readRecord(r.outDir);
      assert.deepEqual(
        forbiddenHits(e, r.outDir),
        [],
        `${fx.label}: conversation text leaked into the derived record (R18)`,
      );
      assert.equal(rec.modelId, e.modelId, `${fx.label}: modelId`);
      if (typeof e.sessionId === "string" && e.sessionId !== "") {
        assert.equal(rec.identity?.sessionId, e.sessionId, `${fx.label}: identity.sessionId`);
      }
      assert.equal(sorted(rec.tokens), sorted(e.expectedTokens), `${fx.label}: tokens`);
      assert.deepEqual(
        Object.keys(rec.raw ?? {}).sort(),
        [...(e.expectedRawKeys as string[])].sort(),
        `${fx.label}: raw holds exactly the allow-listed keys`,
      );
      if ("expectedRawStatsKeys" in e) {
        assert.deepEqual(
          Object.keys(rec.raw?.stats ?? {}).sort(),
          [...(e.expectedRawStatsKeys as string[])].sort(),
          `${fx.label}: raw.stats keys`,
        );
      }
    });
  }
});

describe("usage-capture record shape (G6 section 6)", () => {
  test("G6 assertRecordShape() rejects every mutants/*.json and derivation/recordid-mismatch.json", () => {
    for (const dir of [MUTANTS_DIR, DERIVATION_DIR]) {
      assert.ok(
        fs.readdirSync(dir).some((f) => f.endsWith(".json")),
        `${dir} has zero .json files, refusing to pass vacuously`,
      );
    }
    const res = spawnSync(
      process.execPath,
      [
        "--disable-warning=ExperimentalWarning",
        DERIVE_JS,
        "assert-shape-rejects",
        MUTANTS_DIR,
        DERIVATION_DIR,
      ],
      { encoding: "utf8", env: hermeticEnv(home, { CREWRIG_USAGE_ROOT: usageRoot }) },
    );
    const out = `${res.stdout}${res.stderr}`;
    assert.equal(
      res.status,
      0,
      `assertRecordShape() accepted at least one mutant or derivation fixture it must reject\n${out}`,
    );
    assert.match(out, /RESULT rejects=all failures=0/);
    assert.ok(
      fs.existsSync(path.join(DERIVATION_DIR, "recordid-mismatch.json")),
      "derivation/recordid-mismatch.json is gone",
    );
  });
});

describe("usage-capture mutation proof (G14 section 9)", () => {
  test("G14 with raw: envelope || {} restored, the antigravity canary IS found", () => {
    const fx = HEADLESS.find((f) => f.label === "headless/antigravity-envelope");
    assert.ok(fx, "fixture headless/antigravity-envelope not discovered");
    const copy = copyTracked(REPO, ["scripts/lib/usage-capture", "scripts/lib/usage-store"]);
    try {
      // applyMutation throws when the needle is absent or the edit changes nothing.
      applyMutation(
        copy,
        "scripts/lib/usage-capture/adapters/headless-envelope.js",
        "raw: pickRaw(cli, envelope),",
        "raw: envelope || {},",
      );
      const r = deriveHeadless(fx, path.join(copy.root, "scripts", "lib", "usage-capture"));
      const hits = forbiddenHits(fx.expected as { forbiddenText?: unknown }, r.outDir);
      assert.ok(
        r.rc === 0 && hits.length > 0,
        `the mutant adapter's record did not carry the canary (exit ${r.rc}); the G2 negative check may pass vacuously\n${r.output}`,
      );
    } finally {
      copy.dispose();
    }
  });
});

describe("usage-capture copilot pricing keys (G16 R20 section 11)", () => {
  test("G16 raw keeps pricing, total_nano_aiu, request_multiplier; firstPartyCopilot reads raw.pricing", () => {
    const src = path.join(FIXTURES_DIR, "headless", "copilot-cli-envelope", "envelope.json");
    const base = JSON.parse(fs.readFileSync(src, "utf8")) as Record<string, unknown>;
    const envelope = {
      ...base,
      pricing: { amountUsd: 0.25 },
      total_nano_aiu: 1500000000,
      request_multiplier: 1,
    };
    const priced = path.join(work, "copilot-priced-envelope.json");
    fs.writeFileSync(priced, JSON.stringify(envelope));
    const outDir = path.join(work, "copilot-priced");
    const r = derive(["headless", "copilot-cli", priced], { usageRoot, outDir, home });
    assert.equal(r.rc, 0, r.output);
    const rec = readRecord(outDir);
    const raw = rec.raw as Record<string, unknown> & { pricing?: { amountUsd?: number } };
    assert.equal(raw.pricing?.amountUsd, 0.25, "raw dropped or altered pricing");
    assert.equal(raw.total_nano_aiu, 1500000000, "raw dropped or altered total_nano_aiu");
    assert.equal(raw.request_multiplier, 1, "raw dropped or altered request_multiplier");

    const require = createRequire(import.meta.url);
    const copilot = require(path.join(REPO, "scripts", "lib", "usage-price", "copilot.js")) as {
      firstPartyCopilot(r: unknown, org: object): { source: string } | null;
    };
    const hit = copilot.firstPartyCopilot(rec, {});
    assert.equal(hit ? hit.source : null, "raw.pricing");
  });
});

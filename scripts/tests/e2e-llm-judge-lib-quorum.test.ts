// e2e-llm-judge-lib-quorum.test.ts — quorum, strict, cap, temperature and driver dispatch of
// tests/e2e/lib/llm_judge.ts (ADR 0004 Decision 4, ADR 0007); twin of the first half of
// test-e2e-llm-judge-lib.sh. No network: a queue-driven fetch stands in for the endpoint.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import { makeFixture, queueFetch, run, writeEffective } from "./lib/e2e-llm-judge-fixtures.ts";

const fx = makeFixture();
after(() => fx.cleanup());

const KEY = { ANTHROPIC_JUDGE_API_KEY: "dummy-key" };

async function sequence(name: string, strict: "0" | "1", lines: string[]) {
  const rd = fx.newDir(name);
  writeEffective(rd, {});
  const f = queueFetch(lines);
  const r = await run(fx, { E2E_REPORT_DIR: rd, E2E_JUDGE_STRICT: strict, ...KEY }, f.fetch);
  return { r, rd, f };
}

describe("auth-missing", () => {
  test("default mode: UNCERTAIN + warn, exit 0", async () => {
    const rd = fx.newDir("nokey");
    writeEffective(rd, {});
    const r = await run(fx, { E2E_REPORT_DIR: rd });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^VERDICT=UNCERTAIN/m);
    assert.match(r.stderr, /WARN llm_judge UNCERTAIN reason=auth-missing/);
  });

  test("strict mode: FAIL diag, exit 1", async () => {
    const rd = fx.newDir("nokey-strict");
    writeEffective(rd, {});
    const r = await run(fx, { E2E_REPORT_DIR: rd, E2E_JUDGE_STRICT: "1" });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /# FAIL/);
    assert.match(r.stderr, /auth-missing/);
  });
});

describe("quorum", () => {
  test("PASS/PASS early-exits: exit 0, VERDICT=PASS, counter 2", async () => {
    const { r, rd } = await sequence("3pass", "0", [
      "VERDICT=PASS CONF=0.9",
      "VERDICT=PASS CONF=0.9",
      "VERDICT=PASS CONF=0.9",
    ]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^VERDICT=PASS confidence=/m);
    assert.equal(fs.readFileSync(path.join(rd, "judge.count"), "utf8").trim(), "2");
  });

  test("FAIL/FAIL: exit 1 + VERDICT=FAIL", async () => {
    const { r } = await sequence("2fail", "0", [
      "VERDICT=FAIL CONF=0.8",
      "VERDICT=FAIL CONF=0.8",
      "VERDICT=PASS CONF=0.9",
    ]);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, /^VERDICT=FAIL confidence=/m);
  });

  test("PASS/FAIL/PASS: majority PASS", async () => {
    const { r } = await sequence("pfp", "0", [
      "VERDICT=PASS CONF=0.7",
      "VERDICT=FAIL CONF=0.7",
      "VERDICT=PASS CONF=0.7",
    ]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^VERDICT=PASS confidence=/m);
  });

  const split = ["VERDICT=PASS CONF=0.6", "VERDICT=FAIL CONF=0.6", "VERDICT=UNCERTAIN CONF=0.5"];

  test("no majority: UNCERTAIN, default warns (exit 0)", async () => {
    const { r } = await sequence("pfu", "0", split);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^VERDICT=UNCERTAIN confidence=/m);
    assert.match(r.stderr, /WARN llm_judge UNCERTAIN/);
  });

  test("UNCERTAIN + strict: exit 1", async () => {
    const { r } = await sequence("strict", "1", split);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, /^VERDICT=UNCERTAIN/m);
  });

  test("2 of 3 malformed: UNCERTAIN", async () => {
    const { r } = await sequence("mal", "0", ["VERDICT=PASS CONF=0.7", "MALFORMED", "MALFORMED"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^VERDICT=UNCERTAIN/m);
  });
});

describe("config", () => {
  test("temperature from effective.json reaches the request", async () => {
    const rd = fx.newDir("temp");
    writeEffective(rd, { temperature: 0.5 });
    const f = queueFetch(["VERDICT=PASS CONF=0.9", "VERDICT=PASS CONF=0.9"]);
    await run(fx, { E2E_REPORT_DIR: rd, ...KEY }, f.fetch);
    assert.equal((JSON.parse(f.requests[0]!.body) as { temperature: number }).temperature, 0.5);
  });

  test("unknown backend: exit 1 + FAIL diag", async () => {
    const rd = fx.newDir("nodrv");
    writeEffective(rd, { backend: "nonexistent" });
    const r = await run(fx, { E2E_REPORT_DIR: rd, ...KEY });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /# FAIL/);
    assert.match(r.stderr, /driver for backend=nonexistent/);
  });

  test("auth_mode=api_key parity on the anthropic backend", async () => {
    const rd = fx.newDir("api-key-parity");
    writeEffective(rd, { auth_mode: "api_key" });
    const f = queueFetch(Array(3).fill("VERDICT=PASS CONF=0.9") as string[]);
    const r = await run(fx, { E2E_REPORT_DIR: rd, ...KEY }, f.fetch);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^VERDICT=PASS confidence=/m);
  });

  test("max_calls: cap reached refuses and consumes nothing", async () => {
    const rd = fx.newDir("cap");
    writeEffective(rd, { max_calls: 1 });
    fs.writeFileSync(path.join(rd, "judge.count"), "1\n");
    const f = queueFetch(Array(3).fill("VERDICT=PASS CONF=0.9") as string[]);
    const r = await run(fx, { E2E_REPORT_DIR: rd, ...KEY }, f.fetch);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /per-run cap exceeded/);
    assert.equal(f.remaining(), 3);
  });
});

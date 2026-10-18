// e2e-llm-judge-lib-ollama.test.ts — ollama-cloud driver (issue #127), api_key and keypair modes,
// of tests/e2e/lib/llm_judge.ts. Mocked end to end, no network.

import assert from "node:assert/strict";
import { after, describe, test } from "node:test";

import { makeFixture, run, writeEffective } from "./lib/e2e-llm-judge-fixtures.ts";

const fx = makeFixture();
after(() => fx.cleanup());

const MOCK = { E2E_JUDGE_MOCK: "1", E2E_JUDGE_MOCK_RESPONSE: "VERDICT=PASS CONF=0.95" };

async function judge(name: string, auth_mode: string, env = {}) {
  const rd = fx.newDir(name);
  writeEffective(rd, {
    backend: "ollama-cloud",
    model: "gpt-oss:120b",
    api_key_env: "OLLAMA_API_KEY",
    auth_mode,
    endpoint: "https://ollama.com/v1/chat/completions",
  });
  return run(fx, { E2E_REPORT_DIR: rd, ...env });
}

describe("ollama-cloud", () => {
  test("api_key mode, missing OLLAMA_API_KEY: UNCERTAIN exit 0", async () => {
    const r = await judge("nokey", "api_key");
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^VERDICT=UNCERTAIN/m);
    assert.match(r.stderr, /WARN llm_judge UNCERTAIN reason=auth-missing/);
  });

  test("api_key mode happy path (mocked)", async () => {
    const r = await judge("apikey-ok", "api_key", { OLLAMA_API_KEY: "dummy", ...MOCK });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^VERDICT=PASS confidence=/m);
  });

  test("keypair mode, missing keypair file: UNCERTAIN exit 0", async () => {
    const r = await judge("nokeypair", "keypair", {
      OLLAMA_KEYPAIR_PATH: "/nonexistent/id_ed25519",
    });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^VERDICT=UNCERTAIN/m);
    assert.match(r.stderr, /WARN llm_judge UNCERTAIN reason=auth-missing/);
  });

  test("unknown auth_mode: hard fail exit 1", async () => {
    const r = await judge("bogus", "badmode");
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /# FAIL/);
    assert.match(r.stderr, /preflight returned hard failure/);
  });

  test("keypair mode happy path (mocked)", async () => {
    const r = await judge("keypair-ok", "keypair", MOCK);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^VERDICT=PASS confidence=/m);
  });
});

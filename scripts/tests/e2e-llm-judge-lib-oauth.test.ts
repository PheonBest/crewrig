// e2e-llm-judge-lib-oauth.test.ts — claude-code OAuth driver (issue #126) and Gemini backend
// (issue #128) of tests/e2e/lib/llm_judge.ts. Mocked end to end (E2E_JUDGE_MOCK=1), no network.
// The credential-permission cases need POSIX modes and are skipped on win32.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import { makeFixture, queueFetch, run, writeEffective } from "./lib/e2e-llm-judge-fixtures.ts";

const fx = makeFixture();
after(() => fx.cleanup());

const posix = process.platform === "win32" ? "POSIX file modes are not enforced on win32" : false;
const MOCK = { E2E_JUDGE_MOCK: "1", E2E_JUDGE_MOCK_RESPONSE: "VERDICT=PASS CONF=0.95" };
const FAR_FUTURE_MS = Date.now() + 86_400_000;

function creds(name: string, body: unknown, mode = 0o600): string {
  const p = path.join(fx.tmp, name);
  fs.writeFileSync(p, JSON.stringify(body));
  fs.chmodSync(p, mode);
  return p;
}

const oauthCreds = (token: string | null, expiresAt: number) => ({
  claudeAiOauth: { accessToken: token, expiresAt },
});
const authMissing = /WARN llm_judge UNCERTAIN reason=auth-missing/;

async function judge(name: string, fields: Parameters<typeof writeEffective>[1], env = {}) {
  const rd = fx.newDir(name);
  writeEffective(rd, fields);
  return run(fx, { E2E_REPORT_DIR: rd, ...env });
}

describe("claude-code oauth", () => {
  const f = { backend: "claude-code", auth_mode: "oauth" };

  test("missing credentials file: UNCERTAIN exit 0", async () => {
    const r = await judge("oauth-missing", f, { CLAUDE_CREDENTIALS_PATH: "/nonexistent/c.json" });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^VERDICT=UNCERTAIN/m);
    assert.match(r.stderr, authMissing);
  });

  test("null accessToken: UNCERTAIN exit 0", { skip: posix }, async () => {
    const p = creds("creds_null.json", oauthCreds(null, FAR_FUTURE_MS));
    const r = await judge("oauth-null", f, { CLAUDE_CREDENTIALS_PATH: p });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^VERDICT=UNCERTAIN/m);
    assert.match(r.stderr, authMissing);
  });

  test("expired token: UNCERTAIN exit 0 + driver WARN", { skip: posix }, async () => {
    const p = creds("creds_expired.json", oauthCreds("test-token-abc", 1));
    const r = await judge("oauth-exp", f, { CLAUDE_CREDENTIALS_PATH: p });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^VERDICT=UNCERTAIN/m);
    assert.match(r.stderr, /# WARN claude-code judge: OAuth token expired/);
    assert.match(r.stderr, authMissing);
  });

  test("unknown auth_mode: hard fail exit 1", async () => {
    const r = await judge("oauth-bogus", { backend: "claude-code", auth_mode: "bogus" });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /# FAIL/);
    assert.match(r.stderr, /preflight returned hard failure/);
  });

  test("happy path (mocked): exit 0 + VERDICT=PASS", { skip: posix }, async () => {
    const p = creds("creds_ok.json", oauthCreds("test-oauth-token-abc123", FAR_FUTURE_MS));
    const r = await judge("oauth-ok", f, { CLAUDE_CREDENTIALS_PATH: p, ...MOCK });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^VERDICT=PASS confidence=/m);
  });
});

describe("gemini", () => {
  const key = { api_key_env: "GEMINI_JUDGE_API_KEY" };
  const gem = (auth_mode: string, extra = {}) => ({
    backend: "gemini",
    auth_mode,
    ...key,
    ...extra,
  });
  const refresh = {
    refreshToken: "test-refresh-tok",
    clientId: "test-client-id",
    clientSecret: "s",
  };

  test("api_key missing: UNCERTAIN exit 0", async () => {
    const r = await judge("g-key-missing", gem("api_key"));
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^VERDICT=UNCERTAIN/m);
    assert.match(r.stderr, authMissing);
  });

  test("api_key happy path (mocked)", async () => {
    const r = await judge("g-key-ok", gem("api_key"), { GEMINI_JUDGE_API_KEY: "dummy", ...MOCK });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^VERDICT=PASS confidence=/m);
  });

  test("oauth missing credentials file: UNCERTAIN exit 0", async () => {
    const r = await judge("g-oauth-missing", gem("oauth"), {
      GEMINI_CREDENTIALS_PATH: "/nonexistent/oauth_creds.json",
    });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^VERDICT=UNCERTAIN/m);
    assert.match(r.stderr, authMissing);
  });

  test("oauth unsafe permissions: UNCERTAIN exit 0 + driver WARN", { skip: posix }, async () => {
    const p = creds("g_unsafe.json", refresh, 0o644);
    const r = await judge("g-oauth-perms", gem("oauth"), { GEMINI_CREDENTIALS_PATH: p });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^VERDICT=UNCERTAIN/m);
    assert.match(r.stderr, /unsafe permissions/);
    assert.match(r.stderr, authMissing);
  });

  test("oauth happy path (mocked)", { skip: posix }, async () => {
    const p = creds("g_ok.json", refresh);
    const r = await judge("g-oauth-ok", gem("oauth"), { GEMINI_CREDENTIALS_PATH: p, ...MOCK });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^VERDICT=PASS confidence=/m);
  });

  test("unknown auth_mode: hard fail exit 1", async () => {
    const r = await judge("g-bogus", gem("bogus"));
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /# FAIL/);
    assert.match(r.stderr, /preflight returned hard failure/);
  });

  test("gcp_project forwarded to the request", async () => {
    const rd = fx.newDir("g-gcp");
    writeEffective(rd, gem("api_key", { gcp_project: "my-proj", endpoint: "https://g.example/x" }));
    const f = queueFetch([]);
    const gf = (async (url: string, init: RequestInit) => {
      f.requests.push({ url, headers: init.headers as Record<string, string>, body: "" });
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "VERDICT=PASS CONF=0.9" }] } }],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    await run(fx, { E2E_REPORT_DIR: rd, GEMINI_JUDGE_API_KEY: "k" }, gf);
    assert.equal(f.requests[0]?.headers["x-goog-user-project"], "my-proj");
  });
});

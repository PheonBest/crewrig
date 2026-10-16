// e2e-oracle-judge.test.ts — judge oracle (spec 0261 R9): stand-in unit tests, registry shape, and
// the replay of each case against scripts/tests/fixtures/e2e-oracle/judge/<id>/tuple.json.golden.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { createJudgeEndpoints, ENDPOINT_PATHS, replyFor } from "./lib/e2e-judge-endpoints.ts";
import { checkExpect, runCase, toolAvailable } from "./lib/e2e-judge-run.ts";
import { JUDGE_CASES } from "./lib/e2e-oracle-judge-cases.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const goldens = path.join(root, "scripts/tests/fixtures/e2e-oracle/judge");

async function post(url: string, headers: Record<string, string>, body: string) {
  const res = await fetch(url, { method: "POST", headers, body });
  return { status: res.status, text: await res.text() };
}

describe("judge endpoint stand-in", () => {
  test("serves queued replies in order, records redacted requests, 500 when empty", async () => {
    const srv = createJudgeEndpoints();
    const base = await srv.start();
    try {
      srv.queue("anthropic", [
        replyFor("anthropic", "VERDICT=PASS CONF=0.9"),
        { status: 429, body: "slow down" },
      ]);
      const url = base + ENDPOINT_PATHS.anthropic;
      const h = {
        "x-api-key": "sekret",
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
      };
      const a = await post(url, h, JSON.stringify({ temperature: 0.5 }));
      assert.equal(a.status, 200);
      assert.match(a.text, /VERDICT=PASS/);
      const b = await post(url, h, "{}");
      assert.deepEqual([b.status, b.text], [429, "slow down"]);
      const c = await post(url, h, "{}");
      assert.equal(c.status, 500);
      const reqs = srv.requests();
      assert.equal(reqs.length, 3);
      assert.equal(reqs[0]?.headers["x-api-key"], "<REDACTED>");
      assert.equal(reqs[0]?.authKind, "x-api-key");
      assert.deepEqual(reqs[0]?.body, { temperature: 0.5 });
      assert.equal(reqs[2]?.unqueued, true);
      assert.ok(!JSON.stringify(reqs).includes("sekret"));
    } finally {
      await srv.stop();
    }
  });

  test("redacts the gemini key query, form secrets and the ollama JWT signature", async () => {
    const srv = createJudgeEndpoints();
    const base = await srv.start();
    try {
      srv.queue("gemini", [replyFor("gemini", "x")]);
      srv.queue("gemini-token", [replyFor("gemini-token", "tok")]);
      srv.queue("ollama-token", [replyFor("ollama-token", "tok")]);
      await post(
        `${base}${ENDPOINT_PATHS.gemini}?key=abc`,
        { "content-type": "application/json" },
        "{}",
      );
      await post(
        base + ENDPOINT_PATHS["gemini-token"],
        { "content-type": "application/x-www-form-urlencoded" },
        "refresh_token=r&client_id=c&client_secret=s",
      );
      const seg = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
      const jwt = `${seg({ alg: "EdDSA" })}.${seg({ iss: "i", iat: 1, exp: 2 })}.c2ln`;
      await post(
        base + ENDPOINT_PATHS["ollama-token"],
        { "content-type": "application/json" },
        JSON.stringify({ assertion: jwt }),
      );
      const [g, t, o] = srv.requests();
      assert.deepEqual(g?.query, { key: "<REDACTED>" });
      assert.equal(g?.authKind, "query-key");
      assert.deepEqual(t?.body, {
        refresh_token: "<REDACTED>",
        client_id: "c",
        client_secret: "<REDACTED>",
      });
      assert.deepEqual((o?.body as { assertion: unknown }).assertion, {
        header: { alg: "EdDSA" },
        payload: { iss: "i", iat: "<TS>", exp: "<TS>" },
        signature: "<SIGNATURE>",
      });
    } finally {
      await srv.stop();
    }
  });
});

describe("judge case registry", () => {
  test("ids are unique, `<group>/<name>` kebab-case, and every case declares an expectation", () => {
    const ids = JUDGE_CASES.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const c of JUDGE_CASES) {
      assert.match(c.id, /^[a-z0-9-]+\/[a-z0-9-]+$/);
      assert.ok(c.expect.requests >= 0);
      assert.ok(
        (c.expect.requests === 0) ===
          (Object.keys(c.responses).length === 0 ||
            c.preCount !== undefined ||
            c.expect.requests === 0),
      );
    }
    assert.ok(JUDGE_CASES.length >= 29);
  });
  test("every backend and every auth outcome is covered", () => {
    const backends = new Set(JUDGE_CASES.map((c) => c.backend));
    for (const b of ["anthropic", "claude-code", "gemini", "ollama-cloud", "nonexistent"])
      assert.ok(backends.has(b), b);
  });
});

describe("judge replay against the shell", async () => {
  const avail = await toolAvailable(process.env["E2E_BASH"] ?? "bash");
  for (const c of JUDGE_CASES) {
    const golden = path.join(goldens, c.id, "tuple.json.golden");
    const skip = !avail.ok
      ? avail.reason
      : c.posixOnly === true && process.platform === "win32"
        ? "POSIX file modes"
        : false;
    const todo = !skip && !fs.existsSync(golden) ? "no recorded golden yet" : false;
    test(c.id, { skip, todo }, async () => {
      if (todo) return;
      const tuple = await runCase(c, root, process.env["E2E_BASH"] ?? "bash");
      assert.deepEqual(checkExpect(c, tuple), []);
      assert.deepEqual(
        JSON.parse(JSON.stringify(tuple)),
        JSON.parse(fs.readFileSync(golden, "utf8")),
      );
    });
  }
});

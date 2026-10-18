// usage-dashboard-readonly.test.ts — case 13.16 of the usage dashboard suite (spec 0210 R15-R17, D2, M8;
// replaces the matching group of test-usage-dashboard.sh, spec 0260 row J1a): form B is read-only (the
// sha256 manifest of the root never changes across GET and POST, a record written between two GETs is
// counted) and the offline guard (CREWRIG_USAGE_OFFLINE unset, `fetch` stubbed, zero calls).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import { extractEmbedded } from "./lib/usage-dashboard-checks.ts";
import {
  drv,
  FIXTURES,
  freshSandbox,
  homeMarker,
  manifest,
  NODE_FLAGS,
  REPO,
  type Sandbox,
} from "./lib/usage-dashboard-rig.ts";
import { formToken, startServer, type Server } from "./lib/usage-dashboard-serve.ts";
import { cleanupAll } from "./lib/worktree-fixtures.ts";

const servers: Server[] = [];
const sandboxes: Sandbox[] = [];

after(() => {
  for (const s of servers)
    assert.ok(
      s.child.exitCode !== null || s.child.signalCode !== null,
      "#1371 no serve child process outlives this run (child handle exited)",
    );
  for (const sb of sandboxes)
    assert.deepEqual(homeMarker(sb.home), [], "the temp HOME stays clean");
  cleanupAll();
});

const exitOf = (s: Server, ms: number): Promise<number | null> =>
  new Promise((resolve) => {
    if (s.child.exitCode !== null || s.child.signalCode !== null) return resolve(s.child.exitCode);
    const timer = setTimeout(() => resolve(-1), ms);
    s.child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });

type Count = { totals: { recordCount: number } };

describe("13.16 case_readonly: B is read-only (R15, R16, R17)", () => {
  test("13.16 GET and POST leave the root untouched; a record written between GETs is counted; POST /stop exits 0", async () => {
    const sb = freshSandbox();
    sandboxes.push(sb);
    const server = await startServer(sb);
    servers.push(server);
    try {
      const before = manifest(sb.root);
      const storedMax = drv("stored-computed-max", [sb.root], sb.env).trim();
      const get = await server.get("/");
      const view = await server.get("/view.json");
      const token = formToken(get.body);
      const recompute = await server.post("/recompute", `token=${token}`, {
        "Sec-Fetch-Site": "same-origin",
      });
      let min = "";
      try {
        const v = extractEmbedded(recompute.body) as unknown as {
          totals: { price: { timestamps: { computedAt: { min: string } } } };
        };
        min = v.totals.price.timestamps.computedAt.min;
      } catch {
        // asserted below with the status
      }
      assert.ok(
        min !== "" && storedMax !== "" && min > storedMax,
        `13.16 POST /recompute recomputes: its computedAt is later than every stored one (min '${min}', stored max '${storedMax}', status ${recompute.status})`,
      );
      assert.match(
        recompute.body,
        /task usage:price -- [^<]*--as-of-today/,
        "13.16 the recompute page points to task usage:price -- --as-of-today to persist",
      );
      assert.equal(
        manifest(sb.root),
        before,
        "13.16 sha256 manifest of every file under the root is unchanged across GET /, GET /view.json and POST /recompute",
      );

      // R15: re-read per request, a record the suite writes between two GETs is counted by the second
      const n1 = (JSON.parse(view.body) as Count).totals.recordCount;
      const clone = path.join(sb.home, "fresh-record.json");
      drv(
        "clone-record",
        [
          path.join(FIXTURES, "records", "r01-alpha-pr-1.json"),
          clone,
          "r21-written-between-gets",
          "2026-10-15T10:00:00.000Z",
        ],
        sb.env,
      );
      drv("write-one", [clone], sb.env);
      const m2 = manifest(sb.root);
      const n2 = (JSON.parse((await server.get("/view.json")).body) as Count).totals.recordCount;
      assert.equal(
        n2,
        n1 + 1,
        `13.16 a record written between two GETs is counted by the second (R15): ${n1} then ${n2}`,
      );

      const stop = await server.post("/stop", `token=${token}`);
      const code = await exitOf(server, 5000);
      assert.equal(
        code,
        0,
        `13.16 POST /stop with the token stops the server with exit 0 (status ${stop.status})`,
      );
      assert.equal(
        manifest(sb.root),
        m2,
        "13.16 the manifest is unchanged across the second GET /view.json and POST /stop",
      );
      assert.equal(
        fs.existsSync(path.join(sb.root, "dashboard")),
        false,
        "13.16 form B wrote no page and no pid file under the root",
      );
    } finally {
      await server.stop();
    }
  });
});

// The offline guard (M8): CREWRIG_USAGE_OFFLINE unset, `fetch` stubbed, EUR against a stale FX cache.
const GUARD = String.raw`
const path = require('path');
delete process.env.CREWRIG_USAGE_OFFLINE;
let calls = 0;
globalThis.fetch = async () => { calls += 1; throw new Error('network forbidden in this suite'); };
const req = (r) => require(path.join(process.env.USAGE_TEST_REPO_DIR, r));
const reasons = [];
const walk = (v) => {
  if (Array.isArray(v)) return v.forEach(walk);
  if (v && typeof v === 'object') {
    if (v.fxStaleness && v.fxStaleness.reason) reasons.push(v.fxStaleness.reason);
    Object.values(v).forEach(walk);
  }
};
(async () => {
  const filters = req('scripts/lib/usage-dashboard/filters.js');
  const model = req('scripts/lib/usage-dashboard/model.js');
  const view = await model.build(filters.parse(['--currency', 'EUR']), { now: new Date() });
  walk(view);
  console.log('FETCH_CALLS=' + calls);
  console.log('PRICED=' + view.totals.price.pricedCount);
  console.log('STALENESS=' + [...new Set(reasons)].join(','));
})().catch((e) => { console.log('GUARD-ERROR ' + (e && e.stack || e)); process.exit(1); });
`;

describe("13.16 offline guard (D2, M8)", () => {
  test("13.16 offline guard: zero fetch calls with CREWRIG_USAGE_OFFLINE unset, fxStaleness reads offline, manifest unchanged", () => {
    const sb = freshSandbox();
    sandboxes.push(sb);
    const before = manifest(sb.root);
    const env: NodeJS.ProcessEnv = { ...sb.env, USAGE_TEST_REPO_DIR: REPO };
    delete env["CREWRIG_USAGE_OFFLINE"];
    const r = spawnSync(process.execPath, [...NODE_FLAGS, "-e", GUARD], { encoding: "utf8", env });
    const out = r.stdout + r.stderr;
    assert.match(
      out,
      /^FETCH_CALLS=0$/m,
      "13.16 offline guard: model.build() makes zero fetch calls with CREWRIG_USAGE_OFFLINE unset (D2)",
    );
    assert.match(out, /^PRICED=\d+$/m, "the guard reports PRICED");
    assert.doesNotMatch(out, /^PRICED=0$/m, "13.16 offline guard: some records are priced");
    assert.match(
      out,
      /^STALENESS=(offline)?$/m,
      "13.16 offline guard: any fxStaleness in the view reads offline",
    );
    assert.equal(manifest(sb.root), before, "13.16 offline guard: the root manifest is unchanged");
  });
});

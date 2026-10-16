// usage-dashboard-server.test.ts — cases 13.13, 13.14 and 13.15 of the usage dashboard suite (spec 0210
// R14, R18, R29; replaces the matching groups of test-usage-dashboard.sh, spec 0260 row J1a) and the
// #1371 orphan check: form B binds loopback only, refuses a taken port without a fallback, and guards
// every request. Each server is torn down through POST /stop and a process-group kill, and the child
// handles are asserted exited at the end (the former `pgrep -fl` check, now a child-handle assertion).

import assert from "node:assert/strict";
import net from "node:net";
import os from "node:os";
import { after, describe, test } from "node:test";

import { requireOrSkip } from "./lib/capability.ts";
import { dash, freshSandbox, homeMarker, type Sandbox } from "./lib/usage-dashboard-rig.ts";
import {
  formToken,
  holdPort,
  httpReq,
  startServer,
  type Reply,
  type Server,
} from "./lib/usage-dashboard-serve.ts";
import { cleanupAll } from "./lib/worktree-fixtures.ts";

const servers: Server[] = [];
const sandboxes: Sandbox[] = [];

async function withServer(
  fn: (s: Server, sb: Sandbox) => Promise<void>,
  env: Record<string, string | undefined> = {},
): Promise<void> {
  const sb = freshSandbox();
  sandboxes.push(sb);
  const s = await startServer(sb, [], env);
  servers.push(s);
  try {
    await fn(s, sb);
  } finally {
    await s.stop();
  }
}

after(() => {
  // #1371: no serve child (nor any hold-port holder, owned in-process) outlives this run
  for (const s of servers)
    assert.ok(
      s.child.exitCode !== null || s.child.signalCode !== null,
      "#1371 no serve/hold-port child process outlives this run (child handle exited)",
    );
  for (const sb of sandboxes)
    assert.deepEqual(homeMarker(sb.home), [], "the temp HOME stays clean");
  cleanupAll();
});

const nonInternalIpv4 = (): string | undefined => {
  for (const addrs of Object.values(os.networkInterfaces()))
    for (const a of addrs ?? [])
      if ((a.family === "IPv4" || String(a.family) === "4") && !a.internal) return a.address;
  return undefined;
};

const connectResult = (host: string, port: number): Promise<string> =>
  new Promise((resolve) => {
    const s = net.connect({ host, port, timeout: 3000 });
    s.on("connect", () => {
      s.destroy();
      resolve("CONNECTED");
    });
    s.on("timeout", () => {
      s.destroy();
      resolve("TIMEOUT");
    });
    s.on("error", (e: NodeJS.ErrnoException) => resolve(e.code ?? "ERROR"));
  });

describe("13.13 case_bind: B binds loopback only (R14, R29)", () => {
  test("13.13 BOUND 127.0.0.1", async () => {
    await withServer(async (s) => {
      assert.match(s.log(), /^BOUND 127\.0\.0\.1$/m, "BOUND 127.0.0.1");
    });
  });

  test("13.13 a non-loopback IPv4 connection to the served port is refused", async (t) => {
    const ip = nonInternalIpv4();
    if (ip === undefined && process.platform !== "linux")
      return t.skip("SKIP: no non-internal IPv4 interface to probe the non-loopback bind");
    // a CI Linux runner has an interface: a missing one is a FAIL there, a skip locally
    if (!requireOrSkip(t, ip !== undefined, "no non-internal IPv4 interface on this runner"))
      return;
    await withServer(async (s) => {
      const got = await connectResult(ip!, s.port);
      assert.notEqual(got, "CONNECTED", `connecting to ${ip}:${s.port} is refused (${got})`);
    });
  });

  for (const flag of ["--host", "--bind", "--address"]) {
    test(`13.13 serve ${flag} 0.0.0.0 exits 2`, () => {
      const sb = freshSandbox();
      sandboxes.push(sb);
      const r = dash(["serve", "--port", "0", flag, "0.0.0.0"], sb);
      assert.equal(r.status, 2, `serve ${flag} 0.0.0.0 exits 2: ${r.stderr.slice(0, 200)}`);
    });
  }

  test("13.13 HOST=0.0.0.0 in the environment leaves BOUND at 127.0.0.1", async () => {
    await withServer(
      async (s) => {
        assert.match(s.log(), /^BOUND 127\.0\.0\.1$/m);
        assert.ok(s.port > 0);
      },
      { HOST: "0.0.0.0" },
    );
  });
});

describe("13.14 case_port_conflict: B refuses a taken port (R18)", () => {
  test("13.14 serve --port <taken> exits 3 and names the port; no fallback; the listener keeps it", async () => {
    const held = await holdPort();
    try {
      const sb = freshSandbox();
      sandboxes.push(sb);
      const r = dash(["serve", "--port", String(held.port)], sb);
      const text = r.stdout + r.stderr;
      assert.equal(r.status, 3, `13.14 exit 3: ${text.slice(0, 200)}`);
      assert.ok(
        text.includes(String(held.port)),
        `13.14 serve --port <taken> names port ${held.port}`,
      );
      assert.match(text, /in use/i, "13.14 the message says in use");
      assert.ok(!text.includes("LISTENING"), "13.14 no fallback port was chosen");
      assert.equal(await held.answers(), true, "13.14 the foreign listener still owns the port");
    } finally {
      await held.close();
    }
  });
});

const FORM = { "Content-Type": "application/x-www-form-urlencoded" };

describe("13.15 case_security: B's per-request guard", () => {
  test("13.15 Host allow-list, token, POST 403s, method/path/size guards, headers", async () => {
    await withServer(async (s) => {
      const port = s.port;
      const evil = await s.get("/", { headers: { Host: "evil.example" } });
      const good = await s.get("/", { headers: { Host: `127.0.0.1:${port}` } });
      const local = await s.get("/view.json", { headers: { Host: `localhost:${port}` } });
      assert.deepEqual(
        [evil.status, good.status, local.status],
        [421, 200, 200],
        "13.15 Host: evil.example -> 421; 127.0.0.1:<port> and localhost:<port> -> 200",
      );
      const token = formToken(good.body);
      assert.notEqual(token, "", "13.15 the served page carries a per-process POST token");

      const post = (target: string, body: string, extra: Record<string, string> = {}) =>
        httpReq("POST", port, target, { body, headers: { ...FORM, ...extra } });
      const all: Reply[] = [evil, good, local];
      const posts = [
        await post("/recompute", "token="),
        await post("/recompute", "token=deadbeef"),
        await post("/recompute", `token=${token}`, { Origin: "https://evil.example" }),
        await post("/recompute", `token=${token}`, { "Sec-Fetch-Site": "cross-site" }),
        await post("/stop", "token="),
      ];
      all.push(...posts);
      assert.deepEqual(
        posts.map((p) => p.status),
        [403, 403, 403, 403, 403],
        "13.15 POST without the token, with a wrong token, a foreign Origin or cross-site Sec-Fetch-Site -> 403",
      );

      // the traversal target is sent RAW: `new URL` would normalise `/../..` away and test nothing
      const getRecompute = await s.get("/recompute");
      const put = await httpReq("PUT", port, "/");
      const traversal = await httpReq("GET", port, "/../../etc/passwd");
      const journal = await s.get("/journal/");
      const big = await post("/recompute", `token=${token}&pad=${"a".repeat(20000)}`);
      all.push(getRecompute, put, traversal, journal, big);
      assert.ok([404, 405].includes(Number(getRecompute.status)), "13.15 GET /recompute 404|405");
      assert.equal(put.status, 405, "13.15 PUT 405");
      assert.equal(traversal.status, 404, "13.15 path traversal 404");
      assert.equal(journal.status, 404, "13.15 /journal/ 404");
      assert.equal(big.status, 413, "13.15 a 20 KB body 413");

      for (const r of all)
        assert.deepEqual(
          Object.keys(r.headers).filter((k) => /^access-control-/i.test(k)),
          [],
          "13.15 no response carries an Access-Control-* header",
        );
      const h = good.headers;
      const csp = String(h["content-security-policy"] ?? "");
      assert.match(csp, /default-src .none./, "13.15 CSP default-src none");
      assert.match(csp, /frame-ancestors .none./, "13.15 CSP frame-ancestors none");
      assert.equal(h["cache-control"], "no-store");
      assert.equal(h["x-content-type-options"], "nosniff");
      assert.equal(h["referrer-policy"], "no-referrer");
      assert.equal(h["x-frame-options"], "DENY");
      assert.equal(h["cross-origin-resource-policy"], "same-origin");
    });
  });
});

describe("#1371 teardown", () => {
  test("#1371 POST /stop ends a server with exit 0 and frees its port", async () => {
    const sb = freshSandbox();
    sandboxes.push(sb);
    const s = await startServer(sb);
    servers.push(s);
    const stopped = await s.stop();
    assert.equal(stopped.viaStop, true, "stopped through POST /stop with exit 0");
    assert.equal(await connectResult("127.0.0.1", s.port), "ECONNREFUSED", "the port is free");
  });
});

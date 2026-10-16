// mcp-daemon-status.test.ts — group G17 of the former scripts/tests/test-mcp-daemon.sh
// (spec 0263, row D): the `status-mcp-server.sh` shim. Sections 13a-13d are pinned by
// status-mcp-lifecycle.test.ts; one cross-reference test per section fails if that
// suite loses its literal. Sections 13e and 13f (spec 0172) are asserted here, through
// the shipped shim, against the shared rig (scratch HOME, free loopback port).
//
// The shim leg is POSIX-only (it runs `bash scripts/status-mcp-server.sh`).

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { type FakeMcp, makeRig, type Rig, startFakeMcp } from "./lib/mcp-daemon-rig.ts";
import { cleanupAll, REPO, SKIP_POSIX, which } from "./lib/worktree-fixtures.ts";

const PINNED_BY = path.join(REPO, "scripts", "tests", "status-mcp-lifecycle.test.ts");
const SHIM = path.join(REPO, "scripts", "status-mcp-server.sh");
const BASH = which("bash") ?? "/bin/bash";

const GEMINI_STDIO = {
  mcpServers: {
    mempalace: { command: "python3", args: ["/some/path/mempalace-http-wrapper.py"] },
  },
};
// The TypeScript entry compares the registered endpoint with the probed one (the Bash
// fixture hard-coded 41893 and the old script ignored it), so the URL carries the rig port.
const geminiHttp = (port: number): unknown => ({
  mcpServers: {
    mempalace: {
      url: `http://127.0.0.1:${port}/mcp`,
      headers: { Authorization: "Bearer token123" },
    },
  },
});

describe("mcp-daemon status: sections 13a-13d stay pinned by status-mcp-lifecycle.test.ts", () => {
  const pinned = fs.readFileSync(PINNED_BY, "utf8");
  const sections: ReadonlyArray<readonly [string, readonly string[]]> = [
    ["13a NOT SERVING and the log arms", ["no log at", "probe log line"]],
    ["13b authentication NOT ENFORCED", ["NOT ENFORCED"]],
    ["13c launcher DRIFTED", ["DRIFTED"]],
    ["13d listener owner", ["VERIFIED", "USURPED", "UNVERIFIABLE"]],
  ];
  for (const [title, literals] of sections) {
    test(`${title}: the literals are still asserted`, () => {
      for (const literal of literals) {
        assert.ok(pinned.includes(literal), `status-mcp-lifecycle.test.ts lost ${literal}`);
      }
    });
  }
});

describe("mcp-daemon status: the shim against a serving daemon", { skip: SKIP_POSIX }, () => {
  let rig: Rig;
  let fake: FakeMcp;

  before(async () => {
    rig = await makeRig();
    rig.assertIsolated();
    fake = await startFakeMcp(rig.port, 401);
    rig.installLauncher();
  });
  after(async () => {
    await fake.close();
    rig.cleanup();
    cleanupAll();
  });

  const gemini = (doc: unknown): void => {
    const file = path.join(rig.home, ".gemini", "settings.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(doc, null, 2));
  };
  // Async on purpose: the fake daemon lives in this process, so a blocking spawn
  // would starve it and the probe would time out against a dead event loop.
  const status = (owner: Record<string, string>): Promise<{ status: number | null; out: string }> =>
    new Promise((resolve) => {
      const child = spawn(BASH, [SHIM], {
        cwd: rig.home,
        env: { ...rig.env, MEMPALACE_MCP_HOST: "127.0.0.1", ...owner },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "";
      child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
      child.stderr.on("data", (chunk: Buffer) => (out += chunk.toString()));
      child.on("close", (code) => resolve({ status: code, out }));
    });
  const owned = { MEMPALACE_MCP_EXPECTED_PID: "1234", MEMPALACE_MCP_LISTENER_PID: "1234" };

  test("13d premise: a verified owner and a fresh launcher exit 0 (non-vacuous baseline)", async () => {
    const r = await status(owned);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /VERIFIED/);
  });

  test("13d: a usurping listener names both PIDs and the rotation recovery", async () => {
    const r = await status({
      MEMPALACE_MCP_EXPECTED_PID: "1234",
      MEMPALACE_MCP_LISTENER_PID: "5678",
    });
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.out, /USURPED/);
    assert.match(r.out, /PID 5678[\s\S]*PID 1234/);
    assert.match(r.out, /Rotate/);
  });

  test("13e: a stdio assistant beside a serving daemon is LOCKED OUT (spec 0172 R1)", async () => {
    gemini(GEMINI_STDIO);
    const r = await status(owned);
    assert.notEqual(r.status, 0, r.out);
    assert.ok(r.out.includes("LOCKED OUT"), r.out);
  });

  test("13f: a fully converted http assistant exits 0 and reads http (shared daemon)", async () => {
    gemini(geminiHttp(rig.port));
    const r = await status(owned);
    assert.equal(r.status, 0, r.out);
    assert.ok(r.out.includes("http (shared daemon)"), r.out);
  });
});

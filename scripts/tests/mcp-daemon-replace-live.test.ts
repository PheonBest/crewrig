// mcp-daemon-replace-live.test.ts — group G21 of the former scripts/tests/test-mcp-daemon.sh
// (spec 0263, row D): rotating the token must revoke the old one against a REAL daemon.
// Retires with scripts/lib/common.sh (row J4).
//
// OPT-IN, POSIX only. The Bash suite pointed the launcher at ChromaDB on 127.0.0.1:8001,
// which on a developer machine is the operator's own store; this suite refuses that. The
// test runs only when `mempalace` is importable AND `MCP_DAEMON_LIVE_CHROMA_PORT` names a
// dedicated, disposable ChromaDB (never 8001); otherwise it skips with the reason. The
// daemon runs on a free port with a scratch HOME and is killed by port when the test ends.
// The probe is an independent second implementation (fetch with an Authorization header).

import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { describe, test } from "node:test";

import { makeRig } from "./lib/mcp-daemon-rig.ts";
import { cleanupAll, REPO, SKIP_POSIX } from "./lib/worktree-fixtures.ts";
import path from "node:path";

const COMMON = path.join(REPO, "scripts", "lib", "common.sh");
type Env = Record<string, string | undefined>;
const PYTHON = process.env["MEMPALACE_PYTHON"] ?? "python3";
const CHROMA_PORT = process.env["MCP_DAEMON_LIVE_CHROMA_PORT"] ?? "";
const hasMempalace = !SKIP_POSIX && spawnSync(PYTHON, ["-c", "import mempalace"]).status === 0;
const G21_SKIP: string | false = SKIP_POSIX
  ? SKIP_POSIX
  : !hasMempalace
    ? `SKIP: mempalace is not importable from ${PYTHON}, so no real daemon can start`
    : CHROMA_PORT === "" || CHROMA_PORT === "8001"
      ? "SKIP: set MCP_DAEMON_LIVE_CHROMA_PORT to a disposable ChromaDB port (8001 is the operator's real store and is refused)"
      : false;

describe("G21: rotation revokes the old token against a real daemon", { skip: G21_SKIP }, () => {
  test("the new token is refused until the process is replaced, then the old one is revoked", async (t) => {
    const rig = await makeRig();
    rig.assertIsolated();
    const env = {
      ...rig.env,
      MEMPALACE_CHROMA_HOST: "127.0.0.1",
      MEMPALACE_CHROMA_PORT: CHROMA_PORT,
    };
    const call = (body: string, extra: Env = {}) =>
      spawnSync(
        "bash",
        [
          "-c",
          `set +e; source ${JSON.stringify(COMMON)}; CREWRIG_REPO_DIR=${JSON.stringify(REPO)}; ${body}`,
        ],
        { encoding: "utf8", env: { ...env, ...extra }, cwd: rig.home },
      );
    const kids: ChildProcess[] = [];
    const killDaemon = (): void => {
      for (const kid of kids.splice(0)) {
        try {
          if (kid.pid !== undefined) process.kill(-kid.pid, "SIGKILL");
        } catch {
          /* already gone */
        }
      }
      // The daemon child outlives its launcher's group: match it by its own port.
      spawnSync("pkill", ["-f", `transport http --host 127.0.0.1 --port ${rig.port}`]);
    };
    // The launcher's own preflight binds WITHOUT SO_REUSEADDR (TIME_WAIT residue counts as in use).
    const bindable = (): boolean =>
      spawnSync(PYTHON, [
        "-c",
        `import socket,sys\ns=socket.socket()\ntry: s.bind(("127.0.0.1",${rig.port}))\nexcept OSError: sys.exit(1)`,
      ]).status === 0;
    const healthy = (): Promise<boolean> =>
      fetch(`http://127.0.0.1:${rig.port}/healthz`, { signal: AbortSignal.timeout(2000) }).then(
        (r) => r.ok,
        () => false,
      );
    const probe = async (token: string): Promise<number> =>
      (
        await fetch(`http://127.0.0.1:${rig.port}/mcp`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
          signal: AbortSignal.timeout(3000),
        })
      ).status;
    const start = async (launcher: string): Promise<void> => {
      kids.push(
        spawn("bash", [launcher], { env, stdio: ["ignore", "inherit", "inherit"], detached: true }),
      );
      for (let i = 0; i < 40 && !(await healthy()); i += 1)
        await new Promise((r) => setTimeout(r, 1000));
      assert.ok(await healthy(), "the daemon never became healthy");
    };

    const launcher = call(
      "install_mcp_launcher >/dev/null 2>&1; mcp_launcher_installed_path",
    ).stdout.trim();
    const tokenA = call("mcp_token_read_or_create").stdout.trim();
    await start(launcher);
    const baseline = await probe(tokenA);
    assert.ok(
      baseline >= 200 && baseline < 300,
      `baseline probe with token A returned ${baseline}`,
    );

    fs.rmSync(rig.tokenPath(), { force: true });
    const tokenB = call("mcp_token_read_or_create").stdout.trim();
    assert.notEqual(tokenA, tokenB);
    assert.equal(
      await probe(tokenB),
      401,
      "the new token must be refused while the old process runs (R1)",
    );

    // No supervisor unit under the test label: the replacement must fail visibly (R2).
    const replaced = call("mcp_daemon_replace_process", { MCP_DAEMON_REPLACE_DEADLINE: "2" });
    assert.notEqual(replaced.status, 0, "replace reported success with no unit to replace");

    killDaemon();
    for (let i = 0; i < 80 && !bindable(); i += 1) await new Promise((r) => setTimeout(r, 500));
    await start(launcher);
    const after = await probe(tokenB);
    assert.ok(
      after >= 200 && after < 300,
      `the replaced process returned ${after} for the new token`,
    );
    assert.equal(
      await probe(tokenA),
      401,
      "the replaced process still answers the superseded token",
    );
  });
});

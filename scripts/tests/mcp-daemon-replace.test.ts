// mcp-daemon-replace.test.ts — groups G18, G20 and G22 (behavioural half) of the
// former scripts/tests/test-mcp-daemon.sh (spec 0263, row D): unit materialisation,
// `mcp_daemon_replace_process` (hermetic half) and
// `ensure_mempalace_home`. The structural half of G22 lives in the static-guards file.
// Retires with scripts/lib/common.sh (row J4).
//
// POSIX only: it sources the Bash library. The fake daemon lives in this process, so
// every library call that probes it runs asynchronously (a blocking spawn would starve it).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { type FakeMcp, makeRig, type Rig, startFakeMcp } from "./lib/mcp-daemon-rig.ts";
import { cleanupAll, REPO, SKIP_POSIX } from "./lib/worktree-fixtures.ts";

const COMMON = path.join(REPO, "scripts", "lib", "common.sh");
const TOKEN = `${"a".repeat(48)}\n`;
type Env = Record<string, string | undefined>;

describe("mcp-daemon replace (common.sh)", { skip: SKIP_POSIX }, () => {
  let rig: Rig;
  let seq = 0;
  const home = (...p: string[]): string => path.join(rig.home, ...p);

  /** Run `body` after sourcing common.sh, asynchronously; output is stdout+stderr. */
  const lib = async (
    body: string,
    extra: Env = {},
  ): Promise<{ status: number | null; out: string }> => {
    const script = home(`call-${(seq += 1)}.sh`);
    fs.writeFileSync(
      script,
      `set +e\nsource ${JSON.stringify(COMMON)}\nCREWRIG_REPO_DIR=${JSON.stringify(REPO)}\n${body}\n`,
    );
    const run = await rig.runLauncherBounded(script, 30_000, extra);
    return { status: run.timedOut ? null : run.status, out: run.output };
  };
  /** Serve `code` on the rig port for the duration of `fn`. */
  const withFake = async (code: number, fn: () => Promise<void>): Promise<void> => {
    const fake: FakeMcp = await startFakeMcp(rig.port, code);
    try {
      await fn();
    } finally {
      await fake.close();
    }
  };

  before(async () => {
    rig = await makeRig();
    rig.assertIsolated();
  });
  after(() => {
    rig.cleanup();
    cleanupAll();
  });

  describe("G18: _materialise_mcp_unit refuses an unsubstituted placeholder (R7)", () => {
    test("the two known placeholders materialise and the unit is emitted", async () => {
      const tpl = home("clean.plist");
      fs.writeFileSync(tpl, "__LAUNCHER_PATH__\n__MEMPALACE_HOME__/mcp-server.log\n");
      const r = await lib(`_materialise_mcp_unit ${tpl} ${home("clean-out.plist")}`);
      assert.equal(r.status, 0, r.out);
      assert.ok(fs.existsSync(home("clean-out.plist")), "no unit emitted");
    });

    test("an unknown placeholder is refused and no unit is emitted", async () => {
      const tpl = home("bad.plist");
      fs.writeFileSync(
        tpl,
        "__LAUNCHER_PATH__\n__MEMPALACE_HOME__/mcp-server.log\n__UNKNOWN_KEYS__\n",
      );
      const r = await lib(`_materialise_mcp_unit ${tpl} ${home("bad-out.plist")}`);
      assert.notEqual(r.status, 0, r.out);
      assert.match(r.out, /still contains an unsubstituted placeholder/);
      assert.equal(fs.existsSync(home("bad-out.plist")), false, "a refused unit was emitted");
    });
  });

  describe("G20: mcp_daemon_replace_process (hermetic half, spec 0139 and 0149 delta-01)", () => {
    const replace: Env = { MCP_DAEMON_REPLACE_DEADLINE: "1" };
    before(() => rig.writeToken(TOKEN));

    test("a process already accepting the current token returns 0 and says nothing (R5 carve-out)", async () => {
      await withFake(200, async () => {
        const r = await lib("mcp_daemon_replace_process 2>&1", replace);
        assert.equal(r.status, 0, r.out);
        assert.equal(r.out, "", "no restart window may be disclosed when the token is accepted");
      });
    });

    test("a process that never accepts it fails visibly and discloses the window and the recovery", async () => {
      await withFake(401, async () => {
        const r = await lib("mcp_daemon_replace_process 2>&1", replace);
        assert.notEqual(r.status, 0, r.out);
        assert.ok(r.out.includes("did not accept the current token"), r.out);
        assert.ok(r.out.includes("receives the newly minted token"), r.out);
        assert.match(r.out, /Evict any squatter process[\s\S]*verify port[\s\S]*rotate the token/);
      });
    });

    const squatter = (listener: string, evict: string): Env => ({
      ...replace,
      MEMPALACE_MCP_EXPECTED_PID: "1234",
      MEMPALACE_MCP_LISTENER_PID: listener,
      MEMPALACE_MCP_EVICT_CMD: evict,
    });

    test("a squatter answering 200 is not accepted early (R6)", async () => {
      await withFake(200, async () => {
        const r = await lib("mcp_daemon_replace_process 2>&1", squatter("5678", "true"));
        assert.notEqual(r.status, 0, r.out);
        assert.match(r.out, /squatter PID 5678 detected|failed to evict squatter/);
      });
    });

    test("evicting the squatter lets the verified daemon succeed and runs the command (R6)", async () => {
      const flag = home("evicted.flag");
      await withFake(200, async () => {
        const evict = `touch '${flag}'; export MEMPALACE_MCP_LISTENER_PID=1234`;
        const r = await lib("mcp_daemon_replace_process 2>&1", {
          ...squatter("5678", evict),
          MCP_DAEMON_REPLACE_DEADLINE: "2",
        });
        assert.equal(r.status, 0, r.out);
        assert.ok(fs.existsSync(flag), "the eviction command did not run");
      });
    });

    test("a non-evictable squatter fails visibly (R7)", async () => {
      await withFake(200, async () => {
        const r = await lib("mcp_daemon_replace_process 2>&1", squatter("9999", "true"));
        assert.notEqual(r.status, 0, r.out);
        assert.ok(r.out.includes("failed to evict squatter"), r.out);
      });
    });
  });

  describe("G22: ensure_mempalace_home bootstraps the daemon home (#1196)", () => {
    const fresh = (name: string): string => {
      const dir = home(`home-1196-${name}`);
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    };
    const run = (dir: string, extra: Env = {}) =>
      rig.runCommon("ensure_mempalace_home 2>&1", {
        HOME: dir,
        USERPROFILE: dir,
        MEMPALACE_PALACE_PATH: undefined,
        ...extra,
      });

    test("a fresh HOME gets .mempalace and .mempalace/palace, and a rerun is idempotent", () => {
      const dir = fresh("fresh");
      assert.equal(run(dir).status, 0);
      assert.ok(fs.statSync(path.join(dir, ".mempalace", "palace")).isDirectory());
      assert.equal(run(dir).status, 0, "the rerun failed");
    });

    test("a MEMPALACE_PALACE_PATH override creates the home but no palace directory", () => {
      const dir = fresh("override");
      const elsewhere = home("elsewhere-palace");
      assert.equal(run(dir, { MEMPALACE_PALACE_PATH: elsewhere }).status, 0);
      assert.ok(fs.statSync(path.join(dir, ".mempalace")).isDirectory());
      assert.equal(fs.existsSync(path.join(dir, ".mempalace", "palace")), false);
      assert.equal(fs.existsSync(elsewhere), false);
    });

    test("an uncreatable home fails and names the directory", () => {
      const dir = fresh("blocked");
      fs.writeFileSync(path.join(dir, ".mempalace"), "");
      const r = run(dir);
      assert.notEqual(r.status, 0, r.stdout);
      assert.ok(
        r.stdout.includes("ERROR:") && r.stdout.includes(path.join(dir, ".mempalace")),
        r.stdout,
      );
    });
  });
});

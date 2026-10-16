// mcp-daemon-token-launcher.test.ts — groups G1, G2, G3, G4, G5, G8 and G19 of
// the former scripts/tests/test-mcp-daemon.sh (spec 0263, row D): token
// provisioning, the launcher's token gate, the bounded runner, the launcher
// text, the drift hash and the token-path derivation.
// Retires with scripts/lib/common.sh (row J4).
//
// POSIX only: it sources the Bash library and runs the Bash launcher. The
// TypeScript twins run on Windows in service-launcher-token.test.ts.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { makeRig, modeOf, type Rig } from "./lib/mcp-daemon-rig.ts";
import { cleanupAll, SKIP_POSIX } from "./lib/worktree-fixtures.ts";

// The "green for the wrong reason" trap: a refusal must name the token.
const REASON = "bearer token";
const CHROMA = "ChromaDB daemon unreachable";
const SKIP = SKIP_POSIX;

describe("mcp-daemon token and launcher", { skip: SKIP }, () => {
  let rig: Rig;
  let launcher: string;

  before(async () => {
    rig = await makeRig();
    rig.assertIsolated();
    launcher = rig.installLauncher();
  });
  after(() => {
    rig.cleanup();
    cleanupAll();
  });

  test("G1: a token is created when absent, re-read identically, mode 0600", () => {
    const first = rig.runCommon("mcp_token_read_or_create").stdout.trim();
    assert.notEqual(first, "", "a token is created when absent");
    const second = rig.runCommon("mcp_token_read_or_create").stdout.trim();
    assert.equal(second, first, "re-reading returns the same token (idempotent)");
    assert.equal(modeOf(rig.tokenPath()), 0o600);
  });

  test("G1: a symlinked palace directory yields the same token path (spec 0159)", () => {
    const real = path.join(rig.home, "real_palace");
    const sym = path.join(rig.home, "sym_palace");
    fs.mkdirSync(real, { recursive: true });
    fs.symlinkSync(real, sym);
    const pReal = rig.tokenPath({ MEMPALACE_PALACE_PATH: real });
    const pSym = rig.tokenPath({ MEMPALACE_PALACE_PATH: sym });
    assert.notEqual(pReal, "");
    assert.equal(pSym, pReal);
  });

  test("G2: the launcher is materialised at the installed path", () => {
    assert.equal(launcher, rig.launcherPath);
    assert.ok(fs.statSync(launcher).isFile());
  });

  const refusals: ReadonlyArray<readonly [string, string | null, string]> = [
    ["no token file", null, "bearer token file not found:"],
    ["an empty token", "", "bearer token file is empty or whitespace-only:"],
    ["a whitespace-only token", "   \t  \n", "bearer token file is empty or whitespace-only:"],
    [
      "a token shorter than 32 characters",
      "short\n",
      "bearer token is shorter than 32 characters:",
    ],
    [
      "a token with unexpected characters",
      "has spaces and $(id) in it padded to length aaaaaaaaaaaa\n",
      "bearer token contains unexpected characters:",
    ],
  ];
  for (const [label, content, text] of refusals) {
    test(`G2: the launcher refuses to start with ${label}`, async () => {
      const file = rig.tokenPath();
      fs.rmSync(file, { force: true });
      if (content !== null) rig.writeToken(content);
      const run = await rig.runLauncherBounded(launcher);
      assert.notEqual(run.status, 0, `launcher STARTED (auth would be disabled): ${run.output}`);
      assert.ok(run.output.includes(REASON), `refused, but not for the token: ${run.output}`);
      assert.ok(run.output.includes(text), run.output);
    });
  }

  test("G2: the token reader refuses a whitespace-only token file", () => {
    rig.writeToken("   \n");
    const res = rig.runCommon("mcp_token_read_or_create");
    assert.notEqual(res.status, 0);
    fs.rmSync(rig.tokenPath(), { force: true });
  });

  const accepted: ReadonlyArray<readonly [string, string]> = [
    ["a 48-character alphanumeric token", `${"a".repeat(48)}\n`],
    ["an upstream-style token with - and _", "abcdefghij-klmnopqrst_uvwxyz0123456789ABCDEF\n"],
    ["a valid token with surrounding whitespace", `  ${"a".repeat(48)}  \n`],
  ];
  for (const [label, content] of accepted) {
    test(`G3: ${label} is accepted (dies at the dead ChromaDB port)`, async () => {
      rig.writeToken(content);
      const run = await rig.runLauncherBounded(launcher);
      assert.ok(!run.output.includes(REASON), `refused at the token gate: ${run.output}`);
      assert.ok(run.output.includes(CHROMA), `unexpected outcome: ${run.output}`);
    });
  }

  test("G4: a launcher that never exits is killed at the bound (#1426)", async () => {
    const stub = path.join(rig.home, "stub-hang.sh");
    fs.writeFileSync(stub, "#!/bin/bash\nexec sleep 300\n");
    const run = await rig.runLauncherBounded(stub, 2000);
    assert.notEqual(run.status, 0);
    assert.ok(run.timedOut);
    assert.ok(run.elapsedMs >= 2000 && run.elapsedMs < 10_000, `elapsed ${run.elapsedMs} ms`);
  });

  test("G4: a fast launcher returns promptly with its output kept", async () => {
    const stub = path.join(rig.home, "stub-fast.sh");
    fs.writeFileSync(stub, "#!/bin/bash\necho stub-printed-this\nexit 0\n");
    const run = await rig.runLauncherBounded(stub, 10_000);
    assert.ok(run.output.includes("stub-printed-this"), run.output);
    assert.ok(run.elapsedMs < 5000, `elapsed ${run.elapsedMs} ms`);
  });

  describe("G5: the launcher text keeps the token out of argv", () => {
    let text: string;
    let exec: string;
    before(() => {
      text = fs.readFileSync(launcher, "utf8");
      const joined = text.replace(/\\\n[ \t]*/g, " ");
      exec = joined
        .split("\n")
        .filter((line) => line.startsWith("exec "))
        .join("\n");
    });
    test("the token is exported, not passed as an argument", () => {
      assert.ok(text.includes("export MEMPALACE_MCP_HTTP_TOKEN"));
    });
    test("the handoff execs the wrapper with --transport http", () => {
      assert.ok(exec.includes("--transport http"), exec);
    });
    test("the exec statement carries no TOKEN", () => {
      assert.notEqual(exec, "", "an exec statement exists");
      assert.ok(!exec.includes("TOKEN"), exec);
    });
    test("no token value is baked into the launcher", () => {
      const token = rig.runCommon("mcp_token_read_or_create").stdout.trim();
      assert.notEqual(token, "");
      assert.ok(!text.includes(token));
      fs.rmSync(rig.tokenPath(), { force: true });
    });
  });

  test("G8: the installed launcher records the source hash, no spurious drift", () => {
    const line = fs
      .readFileSync(launcher, "utf8")
      .split("\n")
      .find((l) => l.startsWith("LAUNCHER_SOURCE_SHA="));
    const recorded = (line ?? "").split('"')[1] ?? "";
    assert.notEqual(recorded, "", "a source hash is recorded");
    assert.equal(rig.runCommon("mcp_launcher_source_sha").stdout.trim(), recorded);
  });

  test("G19: the launcher token path agrees with mcp_token_path through a symlink", async () => {
    fs.mkdirSync(path.join(rig.home, "real-palace"), { recursive: true });
    fs.symlinkSync(path.join(rig.home, "real-palace"), path.join(rig.home, "palace-link"));
    const palace = path.join(rig.home, "palace-link", "subdir", "palace");
    fs.rmSync(rig.tokenPath({ MEMPALACE_PALACE_PATH: palace }), { force: true });
    const run = await rig.runLauncherBounded(launcher, 20_000, { MEMPALACE_PALACE_PATH: palace });
    const reported = /bearer token file not found: (.*)/.exec(run.output)?.[1]?.trim() ?? "";
    assert.notEqual(reported, "", `the launcher reported no token path: ${run.output}`);
    assert.equal(reported, rig.tokenPath({ MEMPALACE_PALACE_PATH: palace }));
  });
});

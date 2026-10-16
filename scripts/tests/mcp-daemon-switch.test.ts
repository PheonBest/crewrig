// mcp-daemon-switch.test.ts — group G15 of the former scripts/tests/test-mcp-daemon.sh
// (spec 0263, row D): the `common.sh` switch transaction end to end, sections 11 and
// 11b, plus the R3 unknown arrangement. Only the Bash copy is targeted; the TypeScript
// twin is pinned by switch-transaction.test.ts.
// Retires with scripts/lib/common.sh (row J4).
//
// POSIX only: it sources the Bash library. The failure is injected by a `mktemp` stub
// on PATH matched by path (never by file permissions, which root bypasses, #1215).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { makeRig, type Rig, stubBin } from "./lib/mcp-daemon-rig.ts";
import { cleanupAll, SKIP_POSIX, which } from "./lib/worktree-fixtures.ts";

const CLIS = ["claude", "gemini", "copilot", "antigravity"] as const;

describe("mcp-daemon switch transaction (common.sh)", { skip: SKIP_POSIX }, () => {
  let rig: Rig;
  let pathEnv = "";
  const cfg = (...parts: string[]): string => path.join(rig.home, ...parts);
  const write = (file: string, text: string): void => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  const arrangement = (cli: string): string =>
    rig.runCommon(`mcp_assistant_arrangement ${cli}`, { PATH: pathEnv }).stdout.trim();

  before(async () => {
    rig = await makeRig();
    rig.assertIsolated();
    // The transaction's "present" gate is `command -v`: the four stubs must be on PATH.
    pathEnv = `${rig.stubDir}${path.delimiter}${process.env["PATH"] ?? ""}`;
    write(cfg(".claude.json"), '{"mcpServers":{}}');
    fs.chmodSync(cfg(".claude.json"), 0o600);
    write(
      cfg(".gemini", "settings.json"),
      '{"mcpServers":{"mempalace":{"command":"bash","args":["c"]}}}',
    );
    write(
      cfg(".copilot", "mcp-config.json"),
      '{"mcpServers":{"mempalace":{"command":"bash","args":["p"]}}}',
    );
    write(
      cfg(".gemini", "config", "mcp_config.json"),
      '{"mcpServers":{"mempalace":{"command":"bash","args":["a"]}}}',
    );
  });
  after(() => {
    rig.cleanup();
    cleanupAll();
  });

  test("a switch that fails partway restores the first assistant and names the failing one", () => {
    // Fail exactly one call: write_json_config_secure's mktemp for gemini's settings.json.
    const failDir = cfg("fail-bin");
    stubBin(failDir, []);
    const realMktemp = which("mktemp") ?? "/usr/bin/mktemp";
    const stub = path.join(failDir, "mktemp");
    fs.writeFileSync(
      stub,
      `#!/usr/bin/env bash\nfor arg in "$@"; do\n  case "$arg" in\n    "${cfg(".gemini", "settings.json")}.tmp."*) exit 1 ;;\n  esac\ndone\nexec "${realMktemp}" "$@"\n`,
    );
    fs.chmodSync(stub, 0o755);
    const res = rig.runCommon('switch_assistants_to_http "test-token" 2>&1', {
      PATH: `${failDir}${path.delimiter}${pathEnv}`,
    });
    assert.notEqual(res.status, 0, "the failed switch returned success");
    assert.ok(res.stdout.includes("gemini could not be switched"), res.stdout);
    assert.equal(arrangement("claude"), "none", "claude was not restored after the rollback");
    const doc = JSON.parse(fs.readFileSync(cfg(".claude.json"), "utf8")) as {
      mcpServers: Record<string, unknown>;
    };
    assert.equal("mempalace" in doc.mcpServers, false, "claude kept an orphan HTTP entry");
    fs.rmSync(failDir, { recursive: true, force: true });
  });

  test("a repeated run converges a partial state and reports it (R15)", () => {
    rig.runCommon('register_mempalace_mcp copilot "test-token" >/dev/null 2>&1', { PATH: pathEnv });
    assert.equal(arrangement("copilot"), "http", "premise: copilot is already switched");
    const res = rig.runCommon('switch_assistants_to_http "test-token" 2>&1', { PATH: pathEnv });
    assert.equal(res.status, 0, res.stdout);
    assert.ok(res.stdout.includes("found a partial state"), res.stdout);
    for (const cli of CLIS) assert.equal(arrangement(cli), "http", `${cli} did not converge`);
  });

  test("a non-parseable claude config reads as unknown, not none (R3, spec 0165)", () => {
    fs.writeFileSync(cfg(".claude.json"), "not json\n");
    assert.equal(arrangement("claude"), "unknown");
  });
});

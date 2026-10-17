// mcp-daemon-registration.test.ts — groups G9, G10, G11, G12 (behavioural), G16
// and G23 of the former scripts/tests/test-mcp-daemon.sh (spec 0263, row D):
// the client-configuration registration functions of scripts/lib/common.sh
// (`register_mempalace_mcp`, `mcp_assistant_arrangement`,
// `capture_mempalace_registration`, `restore_mempalace_registration`,
// `_switch_rollback`).
// Retires with scripts/lib/common.sh (row J4).
//
// POSIX only: it sources the Bash library. Every case runs against the
// scratch HOME, USERPROFILE and CLAUDE_CONFIG_DIR of the rig, with the stub
// assistants (claude gemini copilot agy) first on PATH; nothing here touches the
// operator's real client configuration.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { makeRig, modeOf, type Rig } from "./lib/mcp-daemon-rig.ts";
import { cleanupAll, SKIP_POSIX } from "./lib/worktree-fixtures.ts";

const TOKEN = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("mcp-daemon registration", { skip: SKIP_POSIX }, () => {
  let rig: Rig;
  let gemini: string;
  let extra: Record<string, string | undefined>;

  const run = (body: string, more: Record<string, string | undefined> = {}) =>
    rig.runCommon(body, { ...extra, ...more });
  const write = (file: string, text: string, mode = 0o600): void => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    fs.chmodSync(file, mode);
  };
  const arrangement = (): string => run("mcp_assistant_arrangement gemini").stdout.trim();
  const entry = (): Record<string, unknown> => {
    const doc = JSON.parse(fs.readFileSync(gemini, "utf8")) as {
      mcpServers: Record<string, Record<string, unknown>>;
    };
    return doc.mcpServers["mempalace"] ?? {};
  };

  before(async () => {
    rig = await makeRig();
    rig.assertIsolated();
    gemini = path.join(rig.home, ".gemini", "settings.json");
    extra = { PATH: `${rig.stubDir}${path.delimiter}${process.env["PATH"] ?? ""}` };
  });
  after(() => {
    rig.cleanup();
    cleanupAll();
  });

  describe("G9 client configs never widen when the token lands in them (R8)", () => {
    test("a 0600 config stays 0600 after the token is written into it", () => {
      write(gemini, '{"mcpServers":{}}', 0o600);
      run(`register_mempalace_mcp gemini ${TOKEN}`);
      assert.equal(modeOf(gemini).toString(8), "600");
    });
    test("an already-0644 config is narrowed to 0600 once it holds a token", () => {
      write(gemini, '{"mcpServers":{}}', 0o644);
      run(`register_mempalace_mcp gemini ${TOKEN}`);
      assert.equal(modeOf(gemini).toString(8), "600");
    });
  });

  describe("G10 per-assistant arrangement reader (R16, delta-01 R14)", () => {
    const cases: ReadonlyArray<readonly [string, string, string]> = [
      [
        "a command-based entry reads as stdio",
        '{"mcpServers":{"mempalace":{"command":"bash","args":["x"]}}}',
        "stdio",
      ],
      [
        "a url-based entry reads as http",
        '{"mcpServers":{"mempalace":{"type":"http","url":"http://127.0.0.1:1/mcp"}}}',
        "http",
      ],
      [
        "an entry in neither arrangement reads as unknown",
        '{"mcpServers":{"mempalace":{"nonsense":true}}}',
        "unknown",
      ],
      ["no entry reads as none", '{"mcpServers":{}}', "none"],
      ["a non-parseable config reads as unknown, not none (R3)", "not json", "unknown"],
    ];
    for (const [name, json, want] of cases)
      test(name, () => {
        write(gemini, json);
        assert.equal(arrangement(), want);
      });
  });

  describe("G11 capture and restore round-trip (R13)", () => {
    test("register switches to http, replaces (no command key), restore is byte-identical", () => {
      write(gemini, '{"mcpServers":{"mempalace":{"command":"bash","args":["original"]}}}');
      const cap = run("capture_mempalace_registration gemini").stdout.trim();
      run("register_mempalace_mcp gemini test-token");
      assert.equal(arrangement(), "http", "registration switches the entry to http");
      assert.ok(!("command" in entry()), "a spawn-capable key survived the switch (R11)");
      run('restore_mempalace_registration gemini "$CAP"', { CAP: cap });
      assert.equal(arrangement(), "stdio", "restore returns the prior arrangement");
      const restored = run("jq -c .mcpServers.mempalace " + JSON.stringify(gemini)).stdout.trim();
      assert.equal(restored, cap, "restored entry differs from the capture");
    });
  });

  describe("G12 rollback primitives (R13, R14)", () => {
    test("_switch_rollback restores an assistant named in its list", () => {
      write(gemini, '{"mcpServers":{"mempalace":{"command":"bash","args":["orig"]}}}');
      const cap = run("capture_mempalace_registration gemini").stdout.trim();
      run(`register_mempalace_mcp gemini ${TOKEN}`);
      assert.equal(arrangement(), "http");
      run('_switch_rollback "gemini" "null" "$CAP" "null" "null"', { CAP: cap });
      assert.equal(arrangement(), "stdio");
    });
  });

  describe("G16 null-capture restore leaves no orphan (R8)", () => {
    test("null capture, register, restore removes the entry", () => {
      write(gemini, '{"mcpServers":{}}');
      const cap = run("capture_mempalace_registration gemini").stdout.trim();
      assert.equal(cap, "null", "an assistant with no prior entry captures null");
      run("register_mempalace_mcp gemini test-token");
      assert.equal(arrangement(), "http");
      run('restore_mempalace_registration gemini "$CAP"', { CAP: cap });
      assert.equal(arrangement(), "none", "the null restore left an http entry behind");
      assert.ok(
        !(
          "mempalace" in
          (JSON.parse(fs.readFileSync(gemini, "utf8")) as { mcpServers: object }).mcpServers
        ),
      );
    });
  });

  describe("G23 bearer token off jq's argv (#1247)", () => {
    const TOKEN_23 = "test-token-argv-guard-1247";
    test("the token never reaches jq's argv and every config carries it", () => {
      const clis = ["claude", "gemini", "copilot", "antigravity"] as const;
      const cfgOf = (cli: string): string => run(`mcp_assistant_config_path ${cli}`).stdout.trim();
      for (const cli of clis) write(cfgOf(cli), '{"mcpServers":{}}');

      const realJq = run("command -v jq").stdout.trim();
      assert.notEqual(realJq, "", "jq is required");
      const bin = path.join(rig.home, "jq-bin");
      const log = path.join(rig.home, "jq-argv.log");
      fs.mkdirSync(bin, { recursive: true });
      fs.writeFileSync(log, "");
      const stub = path.join(bin, "jq");
      fs.writeFileSync(
        stub,
        `#!/usr/bin/env bash\n{ for a in "$@"; do printf '%s\\x1f' "$a"; done; printf '\\n'; } >> ${JSON.stringify(log)}\nexec ${JSON.stringify(realJq)} "$@"\n`,
      );
      fs.chmodSync(stub, 0o755);
      const stubbed = { PATH: `${bin}${path.delimiter}${extra["PATH"] ?? ""}` };

      for (const cli of clis) {
        const res = run(`register_mempalace_mcp ${cli} ${TOKEN_23} >/dev/null 2>&1`, stubbed);
        assert.equal(res.status, 0, `register_mempalace_mcp ${cli} failed under the jq stub`);
      }
      const cap = run("capture_mempalace_registration gemini", stubbed).stdout.trim();
      assert.ok(cap.includes(TOKEN_23), "the capture must embed the token (non-vacuous restore)");
      const rest = run('restore_mempalace_registration gemini "$CAP" >/dev/null 2>&1', {
        ...stubbed,
        CAP: cap,
      });
      assert.equal(rest.status, 0, "restore failed under the jq stub");

      const logged = fs.readFileSync(log, "utf8");
      assert.ok(logged.length > 0, "the jq stub logged nothing: the argv leg would be vacuous");
      assert.ok(!logged.includes(TOKEN_23), "the token leaked onto jq's argv");

      for (const cli of clis) {
        const auth = run(
          `jq -r .mcpServers.mempalace.headers.Authorization ${JSON.stringify(cfgOf(cli))}`,
        ).stdout.trim();
        assert.equal(auth, `Bearer ${TOKEN_23}`, `${cli} config carries a wrong Authorization`);
      }
    });
  });
});

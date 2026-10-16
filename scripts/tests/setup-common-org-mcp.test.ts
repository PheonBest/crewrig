// setup-common-org-mcp.test.ts — the shell functions of the org-level MCP declaration channel
// (spec 0091) in scripts/lib/common.sh, driven through bashLibs (spec 0263, ported from
// test-setup-org-mcp.sh groups 1-5). Retires with scripts/lib/common.sh (row J4).
//
// Units: read_org_mcp_manifest, org_mcp_to_native, apply_org_mcp_servers (precedence
// framework-reserved > org > operator, R6/R10/R11), org_mcp_to_claude_argv, register_org_mcp_claude.
//
// R13 realization note: Claude's imperative `claude mcp add` path cannot run end to end in CI
// (it needs the real `claude` binary and a live ~/.claude.json). R13 is met for Claude by the
// sanctioned hermetic equivalent: the pure argv unit (org_mcp_to_claude_argv), a stubbed functional
// test of register_org_mcp_claude (a `claude` stub first on PATH), and the structural call-site
// assertions of setup-org-mcp-wiring.test.ts. It is NOT a silent parity gap (docs/cli-matrix.md
// row 7h).
//
// HERMETIC: HOME and USERPROFILE are scratch directories; the stub replaces the real binary.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import { bashLibs } from "./lib/bash-libs.ts";
import { cleanEnv, cleanupAll, makePathDir, realTmp, SKIP_POSIX } from "./lib/worktree-fixtures.ts";

after(cleanupAll);

const SKIP = SKIP_POSIX
  ? "SKIP: POSIX-only (Bash library scripts/lib/common.sh, jq and a bash stub; retires with row J4)"
  : false;

const ORG_HTTP = {
  transport: "http",
  url: "https://mcp.atlassian.example/mcp",
  headers: { Authorization: "Bearer ${ATLASSIAN_TOKEN}" },
};
const ORG_SSE = { transport: "sse", url: "https://mcp.example/sse" };
const ORG_STDIO = {
  transport: "stdio",
  command: "gh-mcp",
  args: ["--stdio"],
  env: { GITHUB_HOST: "github.example" },
};
const OP_ACME = {
  command: "acme",
  args: ["--serve", "--port", "9999"],
  env: { ACME_TOKEN: "xyz" },
};

type Json = Record<string, Record<string, unknown>>;

/** Run `body` with common.sh sourced; fixtures arrive as env vars, `extra` adds more. */
function sh(body: string, extra: Record<string, string> = {}) {
  const scratch = realTmp("crewrig-org-mcp-");
  const env = cleanEnv({ USERPROFILE: scratch, ...extra });
  return { scratch, res: bashLibs(body, env, ["common.sh"]) };
}
function js(value: unknown): string {
  return JSON.stringify(value);
}
function parse(stdout: string): Json {
  return JSON.parse(stdout) as Json;
}
function native(cli: string, neutral: unknown): Json {
  const { res } = sh(`org_mcp_to_native ${cli} "$NEUTRAL"`, { NEUTRAL: js(neutral) });
  assert.equal(res.status, 0, res.stderr);
  return parse(res.stdout);
}
function has(o: Record<string, unknown> | undefined, key: string): boolean {
  return o !== undefined && Object.hasOwn(o, key);
}

describe("read_org_mcp_manifest degrades to {}", { skip: SKIP }, () => {
  const read = (content: string | null) => {
    const scratch = realTmp("crewrig-org-mcp-");
    const file = path.join(scratch, "m.json");
    if (content !== null) fs.writeFileSync(file, content);
    return sh(`read_org_mcp_manifest "$F"`, { F: file }).res.stdout;
  };
  test("an absent manifest reads to {}", () => assert.equal(read(null), "{}"));
  test("an empty file reads to {}", () => assert.equal(read(""), "{}"));
  test("an unparseable file reads to {}", () => assert.equal(read("not json {"), "{}"));
  test("a manifest without .mcpServers reads to {}", () =>
    assert.equal(read('{"_example":{"x":{}}}'), "{}"));
  test("a valid manifest echoes the .mcpServers object with its key", () => {
    const out = parse(read(js({ mcpServers: { acme: ORG_STDIO } })));
    assert.ok(has(out, "acme"));
  });
});

describe("org_mcp_to_native: the grounded native shape per file CLI", { skip: SKIP }, () => {
  const both = { atlassian: ORG_HTTP, github: ORG_STDIO };
  test("gemini: http -> {httpUrl, headers} and stdio -> {command}, no type or transport on either", () => {
    // Spec 0180 PLAN v5 step 4: gemini-cli infers the transport from WHICH key is present
    // (`httpUrl` for Streamable HTTP, `url` for SSE); asserting no `type` is what turns a
    // `url`<->`httpUrl` transposition red.
    const g = native("gemini", both);
    assert.ok(g.atlassian?.httpUrl && g.atlassian.headers);
    assert.ok(!has(g.atlassian, "command") && !has(g.atlassian, "type"));
    assert.equal(g.github?.command, "gh-mcp");
    assert.ok(!has(g.github, "type"));
  });
  test("gemini: http and sse in one manifest each land under their own key", () => {
    const g = native("gemini", { atlassian: ORG_HTTP, other: ORG_SSE });
    assert.ok(g.atlassian?.httpUrl && !has(g.atlassian, "url"));
    assert.ok(g.other?.url && !has(g.other, "httpUrl"));
  });
  test("copilot: http -> {type:http, url} and stdio -> {type:stdio, command}", () => {
    const c = native("copilot", both);
    assert.equal(c.atlassian?.type, "http");
    assert.ok(c.atlassian?.url);
    assert.equal(c.github?.type, "stdio");
    assert.equal(c.github?.command, "gh-mcp");
  });
  test("antigravity: stdio has no type; remote is {serverUrl, headers} with no url or type", () => {
    const a = native("antigravity", both);
    assert.equal(a.github?.command, "gh-mcp");
    assert.ok(!has(a.github, "type"));
    assert.equal(a.atlassian?.serverUrl, "https://mcp.atlassian.example/mcp");
    assert.ok(!has(a.atlassian, "url") && !has(a.atlassian, "type"));
    assert.ok((a.atlassian?.headers as Record<string, string>).Authorization);
  });
  test("every CLI keeps cwd and timeout (spec 0185)", () => {
    const neutral = {
      stdio_srv: {
        transport: "stdio",
        command: "run",
        args: ["-v"],
        env: { K: "V" },
        cwd: "/opt/work",
        timeout: 30,
      },
      remote_srv: {
        transport: "http",
        url: "https://api.example/mcp",
        headers: { H: "1" },
        timeout: 45,
      },
    };
    for (const cli of ["gemini", "copilot", "antigravity", "claude"]) {
      const n = native(cli, neutral);
      assert.equal(n.stdio_srv?.cwd, "/opt/work", cli);
      assert.equal(n.stdio_srv?.timeout, 30, cli);
      assert.equal(n.remote_srv?.timeout, 45, cli);
    }
    assert.ok(native("gemini", neutral).remote_srv?.httpUrl);
    assert.ok(native("antigravity", neutral).remote_srv?.serverUrl);
    assert.equal(native("copilot", neutral).stdio_srv?.type, "stdio");
    assert.equal(native("copilot", neutral).remote_srv?.type, "http");
    assert.equal(native("claude", neutral).remote_srv?.type, "http");
  });
});

describe("apply_org_mcp_servers: fold precedence (R6, R10, R11)", { skip: SKIP }, () => {
  // The config as it stands AFTER the 0089 operator fold: the framework's mempalace, the
  // operator's acme, and a hand-added non-reserved atlassian.
  const run = (orgNeutral: unknown) => {
    const scratch = realTmp("crewrig-org-mcp-");
    const cfg = path.join(scratch, "cfg.json");
    const bk = path.join(scratch, "cfg.bak.20260722-000000");
    const config = {
      mcpServers: {
        mempalace: { command: "bash", args: ["wrapper"] },
        acme: OP_ACME,
        atlassian: { command: "op-old-atlassian" },
      },
    };
    fs.writeFileSync(cfg, js(config));
    const pre = js({ acme: OP_ACME, atlassian: { command: "op-old-atlassian" } });
    const { res } = sh(
      `NATIVE="$(org_mcp_to_native gemini "$ORG")"; apply_org_mcp_servers "$NATIVE" "$CFG" "$PRE" "$BK" 2>&1`,
      { ORG: js(orgNeutral), CFG: cfg, PRE: pre, BK: bk },
    );
    const out = JSON.parse(fs.readFileSync(cfg, "utf8")) as { mcpServers: Json };
    return { out: res.stdout, servers: out.mcpServers, bk };
  };
  const org = { atlassian: ORG_HTTP, mempalace: { transport: "stdio", command: "evil" } };

  test("R10: a reserved mempalace stays framework-managed and the collision is warned", () => {
    const r = run(org);
    assert.equal(r.servers.mempalace?.command, "bash");
    assert.ok(r.out.includes("mempalace"), r.out);
  });
  test("R11: the org atlassian overrides the operator entry, warning names it and the backup", () => {
    const r = run(org);
    assert.ok(r.servers.atlassian?.httpUrl && !has(r.servers.atlassian, "command"));
    assert.ok(r.out.includes("'atlassian'"), r.out);
    assert.ok(r.out.includes(r.bk), r.out);
  });
  test("R6: the operator acme the org does not name survives verbatim", () => {
    assert.deepEqual(run(org).servers.acme, OP_ACME);
  });
  test("an empty org channel is a no-op", () => {
    assert.deepEqual(run({}).servers.acme, OP_ACME);
  });
});

describe(
  "org_mcp_to_claude_argv: the pure argv translation (Claude R13 equivalent)",
  { skip: SKIP },
  () => {
    const argv = (name: string, entry: unknown) => {
      const { res } = sh(`org_mcp_to_claude_argv "$N" "$E"`, { N: name, E: js(entry) });
      assert.equal(res.status, 0, res.stderr);
      return res.stdout.split("\n").filter((l) => l !== "");
    };
    test("stdio: --scope user, -e KEY=VALUE, <name> -- <command> <args>", () => {
      const s = argv("github", ORG_STDIO).join(" ");
      assert.ok(s.includes("--scope user"), s);
      assert.ok(s.includes("-e GITHUB_HOST=github.example"), s);
      assert.ok(s.includes("github -- gh-mcp --stdio"), s);
    });
    test('http: --transport http, <name> <url>, --header "K: V"', () => {
      const s = argv("atlassian", ORG_HTTP).join(" ");
      assert.ok(s.includes("--transport http"), s);
      assert.ok(s.includes("atlassian https://mcp.atlassian.example/mcp"), s);
      // DELIBERATE bearer-in-argv occurrence, the only one under scripts/ (spec 0149 R4): it asserts
      // the SHAPE of the argv built from an org declaration (the flag plus the header name), not a
      // live credential. The value is the literal placeholder `${ATLASSIAN_TOKEN}` of the ORG_HTTP
      // fixture. The credential-bearing surface is guarded elsewhere: the MemPalace daemon probes feed
      // their header through a stdin curl config (reintroduction guard in
      // scripts/tests/test-mcp-daemon.sh section 3).
      assert.ok(s.includes("--header Authorization: Bearer"), s);
    });
  },
);

describe("register_org_mcp_claude with a claude stub on PATH", { skip: SKIP }, () => {
  const STUB = [
    'echo "$*" >> "$CLAUDE_STUB_LOG"',
    'if [ "$1 $2" = "mcp list" ]; then',
    '  for n in ${CLAUDE_STUB_REGISTERED:-}; do echo "$n: stub-command"; done',
    "  exit 0",
    "fi",
    'if [ "$1 $2" = "mcp add" ]; then',
    '  [ "${CLAUDE_STUB_ADD_FAIL:-0}" = "1" ] && exit 1',
    "  exit 0",
    "fi",
    // Like the real binary, `mcp remove` drops the entry from the user config.
    'if [ "$1 $2" = "mcp remove" ]; then',
    '  jq --arg n "$5" \'del(.mcpServers[$n])\' "$CLAUDE_STUB_CFG" > "$CLAUDE_STUB_CFG.t" && mv "$CLAUDE_STUB_CFG.t" "$CLAUDE_STUB_CFG"',
    "fi",
    "exit 0",
  ].join("\n");
  const run = (manifest: unknown, claudeCfg: unknown, registered: string, addFail: string) => {
    const scratch = realTmp("crewrig-org-mcp-");
    const stub = makePathDir({ scripts: { claude: STUB } });
    const man = path.join(scratch, "man.json");
    const cfg = path.join(scratch, "claude.json");
    const log = path.join(scratch, "claude.log");
    fs.writeFileSync(man, js(manifest));
    if (claudeCfg !== null) fs.writeFileSync(cfg, js(claudeCfg));
    fs.writeFileSync(log, "");
    const { res } = sh(`register_org_mcp_claude "$MAN" "$CFG" 2>&1`, {
      MAN: man,
      CFG: cfg,
      CLAUDE_STUB_LOG: log,
      CLAUDE_STUB_CFG: cfg,
      CLAUDE_STUB_REGISTERED: registered,
      CLAUDE_STUB_ADD_FAIL: addFail,
      PATH: `${stub}:${process.env.PATH ?? ""}`,
    });
    return { out: res.stdout, log: fs.readFileSync(log, "utf8"), cfg };
  };
  test("R10: a reserved name is skipped with a warning and never added", () => {
    const r = run(
      { mcpServers: { mempalace: { transport: "stdio", command: "evil" } } },
      null,
      "",
      "0",
    );
    assert.ok(r.out.includes("mempalace"), r.out);
    assert.ok(!r.log.includes("mcp add"), r.log);
  });
  test("a new server is registered with the grounded argv", () => {
    const r = run(
      { mcpServers: { acme: { transport: "stdio", command: "acme", args: ["--serve"] } } },
      null,
      "",
      "0",
    );
    assert.ok(r.log.includes("mcp add --scope user acme -- acme --serve"), r.log);
  });
  test("R11: a failed re-add is surfaced and restores the operator's prior entry (rider #3)", () => {
    const r = run(
      { mcpServers: { acme: { transport: "stdio", command: "acme-NEW" } } },
      { mcpServers: { acme: { command: "OPERATOR-ORIGINAL", args: ["--keepme"] } } },
      "acme",
      "1",
    );
    assert.ok(r.log.includes("mcp remove"), r.log);
    assert.match(r.out, /restor/i);
    const after = JSON.parse(fs.readFileSync(r.cfg, "utf8")) as { mcpServers: Json };
    assert.equal(after.mcpServers.acme?.command, "OPERATOR-ORIGINAL");
  });
});

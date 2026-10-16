// Black-box test of the MCP token probe (spec 0261 R11): `scripts/probe-extension-mcp-token` is
// driven through stand-in vendor executables only (claude, copilot, agy, gh and a `timeout`), as the
// `.sh` today and as the `.ts` twin later, with this file unchanged. Q1 (Copilot token forms), Q2/Q3
// (Antigravity relative command and install rewrite), Q4 (collision, Claude and Copilot) and the
// exit statuses 0 / 1 / 2. The shell needs `jq`; the cases that reach it skip when the host has none.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findTool } from "./lib/hermetic-env.ts";
import { runProbe, shStandIn, type ProbeRun } from "./lib/e2e-probe-blackbox.ts";

const SCRIPT = "probe-extension-mcp-token";
const AGY_NAME = "crewrig-probe-mcp-token";
const AGY_ROOT = `.gemini/config/plugins/${AGY_NAME}`;
const HAS_JQ = findTool("jq") !== undefined;
const NEEDS_JQ = HAS_JQ ? false : "skipped: the shell probe needs jq and the host has none";

interface Options {
  readonly args?: readonly string[];
  readonly missing?: readonly string[];
  readonly jq?: boolean;
  /** Which Copilot token forms expand inside `command`, and whether a bare relative one resolves. */
  readonly tokens?: "both" | "copilot" | "none";
  readonly relative?: boolean;
  readonly ghToken?: string;
  readonly agyRelative?: boolean;
  readonly agyRewrites?: boolean;
  readonly copilotWinner?: "plugin" | "user" | "none";
  readonly claudeNamespaced?: boolean;
  readonly homeFiles?: Record<string, string>;
}

/** A node stand-in: logs argv like `shStandIn`, answers `--version`, then runs `body` (uses `a`, `H`). */
function nodeStandIn(name: string, calls: string, body: string): string {
  return `#!/usr/bin/env node
const fs = require("node:fs");
const cp = require("node:child_process");
const a = process.argv.slice(2);
const H = process.env.HOME;
fs.appendFileSync(${JSON.stringify(calls)}, ${JSON.stringify(name)} + a.map((x) => " <" + x + ">").join("") + "\\n");
if (a[0] === "--version") { console.log("9.9.9"); process.exit(0); }
const rd = (p) => fs.readFileSync(p, "utf8");
${body}
`;
}

const COPILOT = (o: Options): string => `
const store = H + "/.copilot/installed";
if (a[0] === "plugin" && a[1] === "install") {
  const name = JSON.parse(rd(a[2] + "/plugin.json")).name;
  fs.mkdirSync(store, { recursive: true });
  fs.cpSync(a[2], store + "/" + name, { recursive: true });
  process.exit(0);
}
if (a[0] === "plugin" && a[1] === "uninstall") { fs.rmSync(store + "/" + a[2], { recursive: true, force: true }); process.exit(0); }
if (a[0] === "mcp" && a[1] === "get") {
  const w = ${JSON.stringify(o.copilotWinner ?? "plugin")};
  if (w !== "none") console.log('{"name": "probe-args", "source": "' + w + '"}'); else console.log("{}");
  process.exit(0);
}
if (a.includes("-p")) {
  for (const n of fs.existsSync(store) ? fs.readdirSync(store) : []) {
    const dir = store + "/" + n;
    const s = JSON.parse(rd(dir + "/.mcp.json")).mcpServers["probe-args"];
    const t = ${JSON.stringify(o.tokens ?? "both")};
    let c = s.command.split("\${COPILOT_PLUGIN_ROOT}").join(t === "none" ? "\${COPILOT_PLUGIN_ROOT}" : dir);
    c = c.split("\${PLUGIN_ROOT}").join(t === "both" ? dir : "\${PLUGIN_ROOT}");
    if (!c.startsWith("/") && !c.startsWith("$") && ${JSON.stringify(o.relative ?? true)}) c = dir + "/" + c;
    if (c.startsWith("/")) cp.spawnSync(c, s.args, { cwd: dir });
  }
  console.log("OK");
}
process.exit(0);
`;

const AGY = (o: Options): string => `
const dest = H + "/${AGY_ROOT}";
const cfg = H + "/.gemini/config/config.json";
if (a[0] === "plugin" && a[1] === "install") {
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(a[2], dest, { recursive: true });
  if (${JSON.stringify(o.agyRewrites ?? false)}) fs.writeFileSync(dest + "/mcp_config.json", rd(dest + "/mcp_config.json").replace("dist/stub.sh", dest + "/dist/stub.sh"));
  let c = { plugins: {} };
  try { c = JSON.parse(rd(cfg)); } catch {}
  c.plugins = { ...c.plugins, "${AGY_NAME}": {} };
  fs.mkdirSync(H + "/.gemini/config", { recursive: true });
  fs.writeFileSync(cfg, JSON.stringify(c));
  process.exit(0);
}
if (a[0] === "plugin" && a[1] === "enable") process.exit(0);
if (a[0] === "plugin" && a[1] === "uninstall") { fs.rmSync(dest, { recursive: true, force: true }); process.exit(0); }
if (a.includes("-p")) {
  let tools = "read_file";
  if (${JSON.stringify(o.agyRelative ?? true)}) { cp.spawnSync(dest + "/dist/stub.sh", ["relative-form"], { cwd: dest }); tools += "\\nprobe-args"; }
  console.log(JSON.stringify({ response: tools }));
}
process.exit(0);
`;

const CLAUDE = (o: Options): string => `
if (a[0] === "mcp") process.exit(0);
if (a.includes("mcp") && a.includes("list")) {
  if (${JSON.stringify(o.claudeNamespaced ?? true)}) console.log("plugin:crewrig-probe-plugin:probe-args: echo plugin-scope - ok\\nprobe-args: echo user-scope-command - ok");
  else console.log("probe-args: echo user-scope-command - ok");
}
process.exit(0);
`;

function probe(o: Options = {}): ProbeRun {
  return runProbe((calls) => {
    const all: Record<string, string> = {
      claude: nodeStandIn("claude", calls, CLAUDE(o)),
      copilot: nodeStandIn("copilot", calls, COPILOT(o)),
      agy: nodeStandIn("agy", calls, AGY(o)),
      gh: shStandIn("gh", calls, "gh 2.0", `printf '%s' '${o.ghToken ?? "ghp_canned"}'`),
      timeout: '#!/bin/sh\nshift\nexec "$@"\n',
    };
    for (const name of o.missing ?? []) delete all[name];
    return {
      script: SCRIPT,
      args: o.args ?? [],
      standIns: all,
      tools: o.jq === false ? [] : ["jq"],
      ...(o.homeFiles === undefined ? {} : { homeFiles: o.homeFiles }),
    };
  });
}

const count = (run: ProbeRun, prefix: string): number =>
  run.calls.split("\n").filter((l) => l.startsWith(prefix)).length;

describe("probe-extension-mcp-token black box", () => {
  it("exits 1 when jq is not on PATH, before any CLI runs", () => {
    const run = probe({ jq: false });
    assert.equal(run.status, 1);
    assert.equal(run.stderr, "ERROR: jq is required.\n");
    assert.equal(run.calls, "");
  });

  describe("with jq", { skip: NEEDS_JQ }, () => {
    it("rejects an unknown selector with usage and exit 1", () => {
      const run = probe({ args: ["bogus"] });
      assert.equal(run.status, 1);
      assert.match(run.stderr, /Usage: .*\[q1\|q2q3\|q4\|all\]/);
    });

    it("all: every question answered, exit 0, nothing left installed", () => {
      const run = probe({ agyRelative: true });
      assert.equal(run.status, 0, run.stdout + run.stderr);
      assert.match(run.stdout, /form='PLUGIN_ROOT' .*->  SPAWNED/);
      assert.match(run.stdout, /form='COPILOT_PLUGIN_ROOT' .*->  SPAWNED/);
      assert.match(run.stdout, /form='bare-relative-cwd-default' \(dist\/stub\.sh\)  ->  SPAWNED/);
      assert.match(run.stdout, /ARGV: variant-2/);
      assert.match(
        run.stdout,
        /CWD: <WORK>\/copilot-home\/\.copilot\/installed\/crewrig-probe-plugin/,
      );
      assert.match(run.stdout, /VERDICT: agy plugin install copies mcp_config\.json VERBATIM/);
      assert.match(run.stdout, /VERDICT: 'probe-args' IS in the tool list/);
      assert.match(run.stdout, /\(and the stub actually ran — spawn confirmed\)/);
      assert.match(run.stdout, /VERDICT: Claude NAMESPACES the plugin server/);
      assert.match(run.stdout, /VERDICT: Copilot resolves the collision in favour of the PLUGIN/);
      assert.match(
        run.stdout,
        /Record the verdicts above in docs\/runbooks\/extension-mcp-token-probe\.md/,
      );
      assert.equal(run.stderr, "");
      assert.deepEqual(run.tmpLeft, []);
      assert.deepEqual(
        Object.keys(run.files).filter((f) => f.startsWith("home/")),
        ["home/.gemini/config/config.json"],
      );
      assert.deepEqual(JSON.parse(run.files["home/.gemini/config/config.json"] ?? "null"), {
        plugins: {},
      });
      assert.deepEqual(
        Object.keys(run.files).filter((f) => f.startsWith("usage/")),
        ["usage/state/antigravity/version.json"],
      );
      assert.equal(count(run, "agy <plugin> <install>"), 1);
      assert.equal(count(run, "agy <plugin> <uninstall> <crewrig-probe-mcp-token>"), 1);
      assert.equal(count(run, "copilot <plugin> <uninstall>"), 3 + 1 + 1);
    });

    it("Q1: only COPILOT_PLUGIN_ROOT expands, bare relative does not: exit 2", () => {
      const run = probe({ args: ["q1"], tokens: "copilot", relative: false });
      assert.equal(run.status, 2);
      assert.match(run.stdout, /form='PLUGIN_ROOT' .*->  NOT SPAWNED — session output:/);
      assert.match(run.stdout, /form='COPILOT_PLUGIN_ROOT' .*->  SPAWNED/);
      assert.match(run.stdout, /form='bare-relative-cwd-default' .*->  NOT SPAWNED/);
      assert.equal(count(run, "copilot <plugin> <install>"), 3);
      assert.match(run.calls, /copilot <-p> <reply with the single word OK/);
      assert.deepEqual(run.tmpLeft, []);
    });

    it("Q1: SKIP when copilot, gh or the gh token is missing, exit 2", () => {
      const noCopilot = probe({ args: ["q1"], missing: ["copilot"] });
      assert.equal(noCopilot.status, 2);
      assert.match(noCopilot.stdout, /SKIP: copilot not on PATH/);
      const noGh = probe({ args: ["q1"], missing: ["gh"] });
      assert.equal(noGh.status, 2);
      assert.match(noGh.stdout, /SKIP: gh not on PATH/);
      const noToken = probe({ args: ["q1"], ghToken: "" });
      assert.equal(noToken.status, 2);
      assert.match(noToken.stdout, /SKIP: 'gh auth token' produced nothing/);
    });

    it("Q2/Q3: the install rewrites mcp_config.json and the relative command is not listed", () => {
      const run = probe({ args: ["q2q3"], agyRewrites: true, agyRelative: false });
      assert.equal(run.status, 0, run.stdout + run.stderr);
      assert.match(run.stdout, /VERDICT: installed mcp_config\.json DIFFERS from source/);
      assert.match(run.stdout, /VERDICT: 'probe-args' is ABSENT from the tool list/);
      assert.doesNotMatch(run.stdout, /UNEXPECTED/);
      assert.equal(count(run, "agy <plugin> <uninstall>"), 1);
      assert.deepEqual(JSON.parse(run.files["home/.gemini/config/config.json"] ?? "null"), {
        plugins: {},
      });
      assert.ok(!Object.keys(run.files).some((f) => f.includes(AGY_ROOT)), "install root removed");
    });

    it("Q2/Q3: refuses to touch an existing install root, exit 2, nothing installed", () => {
      const seeded = `home/${AGY_ROOT}/keep.txt`;
      const run = probe({ args: ["q2q3"], homeFiles: { [`${AGY_ROOT}/keep.txt`]: "mine" } });
      assert.equal(run.status, 2);
      assert.match(
        run.stderr,
        /ERROR: <SCRATCH>\/home\/\.gemini\/config\/plugins\/crewrig-probe-mcp-token already exists — refusing to touch it\./,
      );
      assert.equal(count(run, "agy <plugin>"), 0);
      assert.deepEqual(Object.keys(run.files), [seeded]);
    });

    it("Q2/Q3: SKIP when agy is missing, exit 2", () => {
      const run = probe({ args: ["q2q3"], missing: ["agy"] });
      assert.equal(run.status, 2);
      assert.match(run.stdout, /SKIP: agy not on PATH/);
    });

    it("Q4: Claude without a namespaced line is INCONCLUSIVE, exit 2", () => {
      const run = probe({ args: ["q4"], claudeNamespaced: false });
      assert.equal(run.status, 2);
      assert.match(run.stdout, /INCONCLUSIVE: expected both a namespaced 'plugin:\.\.\.' line/);
      assert.match(
        run.calls,
        /claude <mcp> <add> <--scope> <user> <probe-args> <--> <echo> <user-scope-command>/,
      );
    });

    it("Q4: Copilot user, plugin and undecided outcomes", () => {
      const user = probe({ args: ["q4"], copilotWinner: "user" });
      assert.match(user.stdout, /in favour of the USER-scope entry/);
      const none = probe({ args: ["q4"], copilotWinner: "none" });
      assert.equal(none.status, 2);
      assert.match(none.stdout, /INCONCLUSIVE: could not determine which entry won\./);
      assert.equal(count(none, "copilot <plugin> <uninstall> <crewrig-probe-plugin-q4>"), 1);
    });

    it("Q4: SKIP lines when claude or copilot is missing, exit 2", () => {
      const run = probe({ args: ["q4"], missing: ["claude", "copilot"] });
      assert.equal(run.status, 2);
      assert.match(run.stdout, /SKIP: claude not on PATH/);
      assert.match(run.stdout, /SKIP: copilot not on PATH/);
    });
  });
});

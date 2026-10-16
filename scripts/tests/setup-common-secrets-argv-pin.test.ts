// setup-common-secrets-argv-pin.test.ts — issue #1248: the MCP fold helpers of scripts/lib/common.sh
// never put a JSON blob that can hold a secret on jq's argv and write only through unpredictable,
// 0600, atomically renamed temp files. A logging `jq` stub (first on the child's PATH only) records
// every argv token, then execs the real jq. Ported from scripts/tests/test-setup-mcp-fold-secrets-argv.sh
// groups G1, G2, G3, G4, G5, G6, G7 and G9 (spec 0263, row A); G8 is the stub itself.
// POSIX-only (Bash library, jq, PATH stub): skipped on win32.
// Retires with scripts/lib/common.sh (row J4).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { bashLibs } from "./lib/bash-libs.ts";
import { cleanEnv, realTmp, SKIP_POSIX, which } from "./lib/worktree-fixtures.ts";

const REAL_JQ = which("jq");
const skip = SKIP_POSIX || (REAL_JQ === null ? "SKIP: a real jq is required" : false);
const quote = (s: string): string => `'${s.replaceAll("'", "'\\''")}'`;
const CANARY = {
  a: "CANARY_SECRET_9f3d2a",
  org: "CANARY_ORG_7b2e1c",
  pre: "CANARY_PRE_4d8f0a",
  from: "CANARY_FROM_1a2b3c",
};

let root = "";
let log = "";

beforeEach(() => {
  root = realTmp("crewrig-fold-argv-");
  log = path.join(root, "argv.log");
  fs.writeFileSync(log, "");
  const stub = path.join(root, "stub");
  fs.mkdirSync(stub);
  fs.writeFileSync(
    path.join(stub, "jq"),
    `#!/usr/bin/env bash\nprintf '%s\\n' "$@" >> ${quote(log)}\nprintf -- '---\\n' >> ${quote(log)}\nexec ${quote(REAL_JQ ?? "jq")} "$@"\n`,
    { mode: 0o755 },
  );
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

/** Run `body` with the logging jq stub first on PATH. */
function run(body: string): ReturnType<typeof bashLibs> {
  const stubbed = `${path.join(root, "stub")}${path.delimiter}${process.env["PATH"] ?? ""}`;
  return bashLibs(body, cleanEnv({ PATH: stubbed, USERPROFILE: root }), ["common.sh"]);
}
const f = (name: string): string => path.join(root, name);
const mode = (file: string): number => fs.statSync(file).mode & 0o777;
interface Cfg {
  mcpServers: Record<string, Record<string, unknown> & { env?: Record<string, string> }>;
}
const json = (file: string): Cfg => JSON.parse(fs.readFileSync(file, "utf8")) as Cfg;
/** Non-vacuity (G9): the stub logged at least one jq call, so the argv leg is not vacuous. */
const argv = (): string => {
  const text = fs.readFileSync(log, "utf8");
  assert.ok(text.split("\n").length > 1, "the jq stub logged nothing");
  return text;
};
const seed = (name: string, text = '{"mcpServers":{}}'): string => {
  fs.writeFileSync(f(name), text);
  return f(name);
};
const planted = (target: string, link: string, text: string): void => {
  fs.writeFileSync(target, text);
  fs.symlinkSync(target, link);
};

describe("common.sh MCP fold helpers keep secrets off jq's argv", { skip }, () => {
  it("G1: merge_preexisting_mcp_servers keeps the canary off argv, in the config, mode 600", () => {
    const cfg = seed("a-cfg.json");
    const pre = `{"github":{"command":"gh-ent","args":["mcp","--stdio"],"env":{"GITHUB_TOKEN":"${CANARY.a}"}}}`;
    const r = run(`merge_preexisting_mcp_servers ${quote(pre)} ${quote(cfg)} "" >/dev/null`);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!argv().includes(CANARY.a), "canary secret appeared on jq's argv");
    assert.equal(json(cfg).mcpServers["github"]?.env?.["GITHUB_TOKEN"], CANARY.a);
    assert.equal(mode(cfg), 0o600);
  });

  it("G2: apply_org_mcp_servers keeps both canaries off argv, warns on 'github', org wins, mode 600", () => {
    const cfg = seed("b-cfg.json");
    const org = `{"github":{"command":"gh-org","args":["mcp"],"env":{"ORG_TOKEN":"${CANARY.org}"}}}`;
    const pre = `{"github":{"command":"gh-old","args":["mcp"],"env":{"OLD_TOKEN":"${CANARY.pre}"}}}`;
    const r = run(`apply_org_mcp_servers ${quote(org)} ${quote(cfg)} ${quote(pre)} "" 2>&1`);
    assert.equal(r.status, 0, r.stderr);
    const text = argv();
    assert.ok(!text.includes(CANARY.org) && !text.includes(CANARY.pre), "a canary reached argv");
    assert.ok(
      r.stdout.includes("'github'"),
      `expected the R11 collision warning (out: ${r.stdout})`,
    );
    assert.equal(json(cfg).mcpServers["github"]?.env?.["ORG_TOKEN"], CANARY.org);
    assert.equal(mode(cfg), 0o600);
  });

  it("G3a: merge_preexisting_mcp_servers never follows a planted <config>.tmp symlink", () => {
    const cfg = seed("c1-cfg.json");
    planted(f("c1-canary.txt"), `${cfg}.tmp`, "UNTOUCHED-MERGE");
    const r = run(
      `merge_preexisting_mcp_servers '{"acme-tools":{"command":"acme"}}' ${quote(cfg)} "" >/dev/null`,
    );
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.readFileSync(f("c1-canary.txt"), "utf8"), "UNTOUCHED-MERGE");
    assert.ok(fs.lstatSync(`${cfg}.tmp`).isSymbolicLink(), "the planted symlink was consumed");
    assert.ok("acme-tools" in json(cfg).mcpServers, "the real config missed the fold");
  });

  it("G3b: apply_org_mcp_servers never follows a planted <config>.tmp symlink", () => {
    const cfg = seed("c2-cfg.json");
    planted(f("c2-canary.txt"), `${cfg}.tmp`, "UNTOUCHED-ORG");
    const r = run(
      `apply_org_mcp_servers '{"github":{"command":"gh-org"}}' ${quote(cfg)} '{}' "" >/dev/null`,
    );
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.readFileSync(f("c2-canary.txt"), "utf8"), "UNTOUCHED-ORG");
    assert.ok(fs.lstatSync(`${cfg}.tmp`).isSymbolicLink(), "the planted symlink was consumed");
    assert.ok("github" in json(cfg).mcpServers, "the real config missed the fold");
  });

  it("G4: write_json_config_secure_from (string src, --slurpfile) keeps the canary off argv, mode 600", () => {
    const src = seed("d1-src.json");
    fs.writeFileSync(f("d1-secret.json"), `{"token":"${CANARY.from}"}`);
    const dest = f("d1-dest.json");
    const r = run(
      `write_json_config_secure_from ${quote(dest)} ${quote(src)} --slurpfile s ${quote(f("d1-secret.json"))} '.mcpServers.x = $s[0]' >/dev/null`,
    );
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!argv().includes(CANARY.from), "canary appeared on jq's argv");
    assert.equal(json(dest).mcpServers["x"]?.["token"], CANARY.from);
    assert.equal(mode(dest), 0o600);
  });

  it("G5: write_json_config_secure_from reads the stdin source form, mode 600", () => {
    const dest = f("d2-dest.json");
    const body = `echo '{"mcpServers":{"mempalace":{"command":"bash"}}}' | write_json_config_secure_from ${quote(dest)} - '.'`;
    const r = run(body);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(json(dest).mcpServers["mempalace"]?.["command"], "bash");
    assert.equal(mode(dest), 0o600);
  });

  it("G6: write_json_config_secure_from never follows planted <dest>.tmp and <dest>.stage symlinks", () => {
    const dest = f("d3-dest.json");
    planted(f("d3-tmp-canary.txt"), `${dest}.tmp`, "UNTOUCHED-TMP");
    planted(f("d3-stage-canary.txt"), `${dest}.stage`, "UNTOUCHED-STAGE");
    const src = seed("d3-src.json");
    const r = run(
      `write_json_config_secure_from ${quote(dest)} ${quote(src)} '.mcpServers.y = 1' >/dev/null`,
    );
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.readFileSync(f("d3-tmp-canary.txt"), "utf8"), "UNTOUCHED-TMP");
    assert.equal(fs.readFileSync(f("d3-stage-canary.txt"), "utf8"), "UNTOUCHED-STAGE");
    assert.ok(
      fs.lstatSync(`${dest}.tmp`).isSymbolicLink() &&
        fs.lstatSync(`${dest}.stage`).isSymbolicLink(),
    );
    assert.equal(json(dest).mcpServers["y"], 1);
    assert.equal(mode(dest), 0o600);
  });
});

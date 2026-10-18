// setup-secrets-fold.test.ts — issue #1248 in TypeScript: the MCP fold of scripts/lib/setup/ keeps a
// secret canary verbatim in the written config, writes it at 0600 through an unpredictable temp name,
// never follows a planted `<file>.tmp` or `<file>.stage` symlink, and starts no child process (the
// Bash property "the secret is never on jq's argv", strictly stronger here: there is no jq). Ported
// from scripts/tests/test-setup-mcp-fold-secrets-argv.sh groups G1-G6, G7 (0600) and G9 (spec 0263,
// row A). Symlink and mode legs are POSIX-only.

import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { syncBuiltinESMExports } from "node:module";

import type { JsonValue } from "../lib/extension/types.ts";
import { mergePreexistingMcpServers, toJsonValue } from "../lib/setup/mcp-json-writers.ts";
import { applyOrgMcpServers } from "../lib/setup/org-mcp-fold.ts";
import { writeJsonConfigSecure } from "../lib/setup/json-secure.ts";

const POSIX = process.platform === "win32" ? "SKIP: POSIX-only (mode bits, symlinks)" : false;
const SPAWNERS = [
  "spawn",
  "spawnSync",
  "execFile",
  "execFileSync",
  "exec",
  "execSync",
  "fork",
] as const;

let dir = "";
let out: string[];
const ctx = () => ({
  io: {
    out: (l: string): void => void out.push(l),
    err: (l: string): void => void out.push(l),
    errRaw: (l: string): void => void out.push(l),
  },
  platform: process.platform,
});
const f = (name: string): string => path.join(dir, name);
const mode = (file: string): number => fs.statSync(file).mode & 0o777;
interface Cfg {
  mcpServers: Record<string, Record<string, unknown> & { env?: Record<string, string> }>;
}
const doc = (file: string): Cfg => JSON.parse(fs.readFileSync(file, "utf8")) as Cfg;
const val = (text: string): JsonValue => toJsonValue(JSON.parse(text));
const asMap = (v: JsonValue): Map<string, JsonValue> => v as Map<string, JsonValue>;

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "setup-secrets-fold-")));
  out = [];
  // Zero child processes during the fold: any spawn fails the test.
  for (const name of SPAWNERS) {
    mock.method(childProcess, name, () => assert.fail(`${name} was called during the fold`));
  }
  syncBuiltinESMExports();
});
afterEach(() => {
  mock.restoreAll();
  syncBuiltinESMExports();
  fs.rmSync(dir, { recursive: true, force: true });
});

function planted(victim: string, link: string, text: string): void {
  fs.writeFileSync(victim, text);
  fs.symlinkSync(victim, link);
}

describe("secrets in the MCP fold", () => {
  it(
    "G1: the merged pre-existing server keeps its canary verbatim, mode 600",
    { skip: POSIX },
    () => {
      const pre = asMap(
        val('{"github":{"command":"gh-ent","env":{"GITHUB_TOKEN":"CANARY_SECRET_9f3d2a"}}}'),
      );
      const merged = mergePreexistingMcpServers(
        ctx(),
        { servers: pre, backup: "" },
        new Map([["mcpServers", new Map()]]),
      );
      const cfg = f("a-cfg.json");
      writeJsonConfigSecure({ ctx: ctx(), file: cfg, value: merged, backup: false });
      assert.equal(doc(cfg).mcpServers["github"]?.env?.["GITHUB_TOKEN"], "CANARY_SECRET_9f3d2a");
      assert.equal(mode(cfg), 0o600);
    },
  );

  it("G2: the org fold warns on 'github', the org canary wins, mode 600", { skip: POSIX }, () => {
    const cfg = f("b-cfg.json");
    fs.writeFileSync(cfg, '{"mcpServers":{}}');
    const org = asMap(
      val('{"github":{"command":"gh-org","args":["mcp"],"env":{"ORG_TOKEN":"CANARY_ORG_7b2e1c"}}}'),
    );
    const pre = asMap(
      val('{"github":{"command":"gh-old","env":{"OLD_TOKEN":"CANARY_PRE_4d8f0a"}}}'),
    );
    assert.equal(applyOrgMcpServers(ctx(), "gemini", org, cfg, pre, ""), true);
    assert.ok(
      out.some((l) => l.includes("'github'")),
      `no R11 warning: ${out.join("|")}`,
    );
    const text = fs.readFileSync(cfg, "utf8");
    assert.equal(doc(cfg).mcpServers["github"]?.env?.["ORG_TOKEN"], "CANARY_ORG_7b2e1c");
    assert.ok(!text.includes("CANARY_PRE_4d8f0a"));
    assert.equal(mode(cfg), 0o600);
  });

  it("G3a: the merge write never follows a planted <config>.tmp symlink", { skip: POSIX }, () => {
    const cfg = f("c1-cfg.json");
    fs.writeFileSync(cfg, '{"mcpServers":{}}');
    planted(f("c1-canary.txt"), `${cfg}.tmp`, "UNTOUCHED-MERGE");
    const pre = asMap(val('{"acme-tools":{"command":"acme"}}'));
    const merged = mergePreexistingMcpServers(
      ctx(),
      { servers: pre, backup: "" },
      new Map([["mcpServers", new Map()]]),
    );
    writeJsonConfigSecure({ ctx: ctx(), file: cfg, value: merged, backup: false });
    assert.equal(fs.readFileSync(f("c1-canary.txt"), "utf8"), "UNTOUCHED-MERGE");
    assert.ok(fs.lstatSync(`${cfg}.tmp`).isSymbolicLink());
    assert.ok("acme-tools" in doc(cfg).mcpServers);
  });

  it("G3b: the org fold never follows a planted <config>.tmp symlink", { skip: POSIX }, () => {
    const cfg = f("c2-cfg.json");
    fs.writeFileSync(cfg, '{"mcpServers":{}}');
    planted(f("c2-canary.txt"), `${cfg}.tmp`, "UNTOUCHED-ORG");
    applyOrgMcpServers(
      ctx(),
      "gemini",
      asMap(val('{"github":{"command":"gh-org"}}')),
      cfg,
      new Map(),
      "",
    );
    assert.equal(fs.readFileSync(f("c2-canary.txt"), "utf8"), "UNTOUCHED-ORG");
    assert.ok(fs.lstatSync(`${cfg}.tmp`).isSymbolicLink());
    assert.ok("github" in doc(cfg).mcpServers);
  });

  it("G4: from a file plus a patch keeps the canary verbatim, mode 600", { skip: POSIX }, () => {
    const src = f("d1-src.json");
    fs.writeFileSync(src, '{"mcpServers":{}}');
    const dest = f("d1-dest.json");
    writeJsonConfigSecure({
      ctx: ctx(),
      file: dest,
      from: src,
      backup: false,
      patch: (d) => {
        asMap(asMap(d).get("mcpServers") as JsonValue).set(
          "x",
          val('{"token":"CANARY_FROM_1a2b3c"}'),
        );
        return d;
      },
    });
    assert.equal(doc(dest).mcpServers["x"]?.["token"], "CANARY_FROM_1a2b3c");
    assert.equal(mode(dest), 0o600);
  });

  it("G5: a document source lands in the destination, mode 600", { skip: POSIX }, () => {
    const dest = f("d2-dest.json");
    writeJsonConfigSecure({
      ctx: ctx(),
      file: dest,
      from: val('{"mcpServers":{"mempalace":{"command":"bash"}}}'),
      backup: false,
      patch: (d) => d,
    });
    assert.equal(doc(dest).mcpServers["mempalace"]?.["command"], "bash");
    assert.equal(mode(dest), 0o600);
  });

  it("G6: planted <dest>.tmp and <dest>.stage symlinks stay untouched", { skip: POSIX }, () => {
    const dest = f("d3-dest.json");
    planted(f("d3-tmp-canary.txt"), `${dest}.tmp`, "UNTOUCHED-TMP");
    planted(f("d3-stage-canary.txt"), `${dest}.stage`, "UNTOUCHED-STAGE");
    const src = f("d3-src.json");
    fs.writeFileSync(src, '{"mcpServers":{}}');
    writeJsonConfigSecure({
      ctx: ctx(),
      file: dest,
      from: src,
      backup: false,
      patch: (d) => {
        asMap(asMap(d).get("mcpServers") as JsonValue).set("y", 1);
        return d;
      },
    });
    assert.equal(fs.readFileSync(f("d3-tmp-canary.txt"), "utf8"), "UNTOUCHED-TMP");
    assert.equal(fs.readFileSync(f("d3-stage-canary.txt"), "utf8"), "UNTOUCHED-STAGE");
    assert.ok(
      fs.lstatSync(`${dest}.tmp`).isSymbolicLink() &&
        fs.lstatSync(`${dest}.stage`).isSymbolicLink(),
    );
    assert.equal(doc(dest).mcpServers["y"], 1);
    assert.equal(mode(dest), 0o600);
  });
});

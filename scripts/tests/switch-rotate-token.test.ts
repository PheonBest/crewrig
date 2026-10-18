// switch-rotate-token.test.ts — `switch-mempalace-http --rotate` end to end
// (spec 0176; spec 0263, port of scripts/tests/test-rotate-mempalace-token.sh):
// the whole shim and the TypeScript entry over four real-shaped assistant
// configs in a scratch HOME, with CREWRIG_TEST_MOCK_DAEMON=true so no daemon is
// installed or contacted. The in-process order is switch-transaction.test.ts.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";
import { makeRig, modeOf, REPO, scratchRoot, type Rig } from "./lib/repair-rig.ts";

const root = scratchRoot("crewrig-rotate-");
after(() => fs.rmSync(root, { recursive: true, force: true }));
const posix = process.platform !== "win32";
const TOKEN_A = `token_initial_${"A".repeat(40)}`;

const CONFIGS: Array<[string, string[], string]> = [
  ["claude", [".claude.json"], "url"],
  ["gemini", [".gemini", "settings.json"], "url"],
  ["copilot", [".copilot", "mcp-config.json"], "url"],
  ["antigravity", [".gemini", "config", "mcp_config.json"], "serverUrl"],
];

function rig(name: string): Rig {
  const r = makeRig(root, name, ["claude", "gemini", "copilot", "agy", "antigravity"]);
  for (const [, parts, key] of CONFIGS) {
    const file = path.join(r.home, ...parts);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const entry = {
      [key]: "http://127.0.0.1:8765/mcp",
      headers: { Authorization: `Bearer ${TOKEN_A}` },
    };
    fs.writeFileSync(file, JSON.stringify({ mcpServers: { mempalace: entry } }));
    fs.writeFileSync(`${file}.bak.20260101-000000`, "old-backup");
  }
  return r;
}

/** The token file of the scratch HOME, through the same module the tool uses. */
function tokenFile(r: Rig): string {
  const code =
    'import("./scripts/lib/service/token.ts").then((m) => process.stdout.write(m.tokenFilePath()))';
  const res = spawnSync(process.execPath, ["-e", code], {
    cwd: REPO,
    env: r.env,
    encoding: "utf8",
  });
  assert.equal(res.status, 0, res.stderr);
  return res.stdout;
}

const entry = (cmd: "ts", r: Rig, args: string[]): { status: number | null; out: string } => {
  const [bin, argv] = [process.execPath, [`scripts/switch-mempalace-http.${cmd}`, ...args]];
  const res = spawnSync(bin as string, argv as string[], {
    cwd: REPO,
    env: r.env,
    encoding: "utf8",
    timeout: 60_000,
  });
  return { status: res.status, out: res.stdout + res.stderr };
};

const bearer = (r: Rig, parts: string[]): string => {
  const doc = JSON.parse(fs.readFileSync(path.join(r.home, ...parts), "utf8")) as {
    mcpServers: { mempalace: { headers: { Authorization: string } } };
  };
  return doc.mcpServers.mempalace.headers.Authorization;
};

for (const which of ["ts"] as const) {
  describe(`switch --rotate (TypeScript entry)`, { skip: !posix && "POSIX stubs" }, () => {
    test("G1: --help documents --rotate; an unknown flag exits non-zero", () => {
      const r = rig(`g1${which}`);
      assert.ok(entry(which, r, ["--help"]).out.includes("--rotate"));
      assert.notEqual(entry(which, r, ["--invalid-flag"]).status, 0);
    });

    test("G2-G4: rotate mints a distinct 0600 token, re-registers all four configs, purges every .bak.*", () => {
      const r = rig(`g2${which}`);
      const file = tokenFile(r);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${TOKEN_A}\n`, { mode: 0o600 });
      entry(which, r, ["--rotate"]);
      const b = fs.readFileSync(file, "utf8").trim();
      assert.notEqual(b, TOKEN_A);
      assert.ok(b.length >= 32, `token length ${b.length}`);
      assert.equal(modeOf(file), "600");
      for (const [name, parts] of CONFIGS) {
        assert.equal(bearer(r, parts), `Bearer ${b}`, `${name} config carries the new token`);
      }
      const left: string[] = [];
      const walk = (dir: string): void => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, e.name);
          if (e.isDirectory()) walk(p);
          else if (e.name.includes(".bak.")) left.push(p);
        }
      };
      walk(r.home);
      assert.deepEqual(left, []);
    });

    test("G5: a plain run keeps the existing token", () => {
      const r = rig(`g5${which}`);
      const file = tokenFile(r);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${TOKEN_A}\n`, { mode: 0o600 });
      entry(which, r, []);
      assert.equal(fs.readFileSync(file, "utf8").trim(), TOKEN_A);
    });
  });
}

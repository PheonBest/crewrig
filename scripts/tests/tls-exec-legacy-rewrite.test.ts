// tls-exec-legacy-rewrite.test.ts — an installed `bash <repo>/scripts/lib/tls-exec.sh <command...>`
// command line is rewritten to `node <repo>/scripts/tls-exec.ts <command...>` by the next setup run,
// without the `.sh` file existing, and a further run writes nothing (spec 0266 R9, parent spec 0215
// R15; slice 5b). One case per configuration surface: the recogniser, the playwright model, Claude
// Code (through `claude mcp`), Gemini CLI (settings.json), Copilot CLI and Antigravity CLI (the
// shared MCP merge). The Chroma unit is covered by setup-chroma-unit.test.ts. Every file lives in
// a scratch directory made with mkdtemp.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import { parseJson } from "../lib/extension/json-ordered.ts";
import type { JsonValue } from "../lib/extension/types.ts";
import { classify } from "../lib/playwright-mcp-shape.ts";
import type { Spawner } from "../lib/setup/context.ts";
import { mergeGeminiSettings } from "../lib/setup/gemini-settings-merge.ts";
import { mergePreexistingMcpServers } from "../lib/setup/mcp-json-writers.ts";
import { upgradeLegacyClaudeEntries } from "../lib/setup/mcp-claude-upgrade.ts";
import { trustWrapperPrefix } from "../lib/setup/trust-wrapper.ts";
import {
  isLegacyWrapperLine,
  isLegacyWrapperPath,
  upgradeLegacyEntry,
} from "../lib/tls-exec/legacy.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "tls-exec-legacy-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const REPO = "/work/crewrig";
const OLD = "/old/clone/scripts/lib/tls-exec.sh";
const NEW = `${REPO}/scripts/tls-exec.ts`;
const PKG = "@playwright/mcp@latest";
const env = { platform: "linux", home: "/home/a", repoDir: REPO } as const;
const prefix = trustWrapperPrefix(env);

describe("recogniser", () => {
  it("accepts the legacy wrapper of any checkout, by text, with no file behind it", () => {
    assert.equal(isLegacyWrapperPath(OLD), true);
    assert.equal(isLegacyWrapperPath("C:\\src\\crewrig\\scripts\\lib\\tls-exec.sh"), true);
    assert.equal(fs.existsSync(OLD), false);
  });

  it("rejects what is not exactly the legacy line", () => {
    assert.equal(isLegacyWrapperPath("scripts/lib/tls-exec.sh"), false, "relative");
    assert.equal(isLegacyWrapperPath("/x/my-tls-exec.sh"), false);
    assert.equal(isLegacyWrapperPath("/x/scripts/lib/tls-exec.ts"), false);
    assert.equal(isLegacyWrapperLine("sh", [OLD, "npx"]), false);
    assert.equal(isLegacyWrapperLine("bash", ["-x", OLD]), false);
    assert.equal(isLegacyWrapperLine("bash", []), false);
  });

  it("rewrites the two wrapper words and keeps the rest and the key order", () => {
    const entry = new Map<string, JsonValue>([
      ["type", "stdio"],
      ["command", "bash"],
      ["args", [OLD, "npx", "-y", "pkg"]],
      ["timeout", 5],
    ]);
    const up = upgradeLegacyEntry(entry, prefix);
    assert.deepEqual([...(up?.keys() ?? [])], ["type", "command", "args", "timeout"]);
    assert.equal(up?.get("command"), "node");
    assert.deepEqual(up?.get("args"), [NEW, "npx", "-y", "pkg"]);
    assert.equal(
      upgradeLegacyEntry(up, prefix),
      undefined,
      "the node form is not recognised again",
    );
  });
});

describe("playwright model", () => {
  it("reads the legacy wrapped form as relocated, with the old path", () => {
    const entry = { command: "bash", args: [OLD, "npx", PKG] };
    assert.deepEqual(classify("gemini", entry, NEW), { kind: "relocated", oldPath: OLD });
    assert.deepEqual(classify("gemini", { command: "node", args: [NEW, "npx", PKG] }, NEW), {
      kind: "wrapped-current",
    });
  });
});

describe("Claude Code", () => {
  function claudeHome(servers: Record<string, unknown>): { home: string; file: string } {
    const home = fs.mkdtempSync(path.join(root, "claude-"));
    const file = path.join(home, ".claude.json");
    fs.writeFileSync(file, JSON.stringify({ mcpServers: servers }));
    return { home, file };
  }
  // A stand-in for the `claude` CLI that keeps `.claude.json` in step with `mcp remove` / `mcp add`.
  function fakeClaude(file: string, calls: string[][]): Spawner {
    return (argv) => {
      calls.push([...argv]);
      const doc = JSON.parse(fs.readFileSync(file, "utf8")) as {
        mcpServers: Record<string, unknown>;
      };
      if (argv[2] === "remove") delete doc.mcpServers[argv[5] ?? ""];
      if (argv[2] === "add") {
        const rest = argv.slice(7);
        doc.mcpServers[argv[5] ?? ""] = {
          type: "stdio",
          command: rest[0],
          args: rest.slice(1),
          env: {},
        };
      }
      fs.writeFileSync(file, JSON.stringify(doc));
      return { status: 0, stdout: "", stderr: "" };
    };
  }

  it("removes and re-adds each legacy registration once, then a second run does nothing", () => {
    const { home, file } = claudeHome({
      sequentialthinking: {
        type: "stdio",
        command: "bash",
        args: [OLD, "npx", "-y", "seq"],
        env: {},
      },
      mempalace: { type: "stdio", command: "bash", args: [OLD, "/py", "/w.py"], env: {} },
      playwright: { type: "stdio", command: "bash", args: [OLD, "npx", PKG], env: {} },
      mine: { type: "stdio", command: "bash", args: [OLD, "own"], env: {} },
    });
    const calls: string[][] = [];
    const out: string[] = [];
    const ctx = { io: { out: (l: string) => void out.push(l) }, ...env, home } as Parameters<
      typeof upgradeLegacyClaudeEntries
    >[0];
    const done = upgradeLegacyClaudeEntries(ctx, fakeClaude(file, calls));
    assert.deepEqual(done, ["sequentialthinking", "mempalace", "playwright"]);
    assert.deepEqual(calls[1], [
      "claude",
      "mcp",
      "add",
      "--scope",
      "user",
      "sequentialthinking",
      "--",
      "node",
      NEW,
      "npx",
      "-y",
      "seq",
    ]);
    assert.equal(calls.length, 6, "a remove and an add per rewritten server, nothing for `mine`");
    const after = fs.readFileSync(file, "utf8");
    const again: string[][] = [];
    assert.deepEqual(upgradeLegacyClaudeEntries(ctx, fakeClaude(file, again)), []);
    assert.deepEqual(again, []);
    assert.equal(fs.readFileSync(file, "utf8"), after);
    const servers = (JSON.parse(after) as { mcpServers: Record<string, { command: string }> })
      .mcpServers;
    assert.equal(
      servers["mine"]?.command,
      "bash",
      "an unrecognised registration is the operator's",
    );
  });

  it("leaves a registration with an environment or an extra field alone", () => {
    const { home, file } = claudeHome({
      playwright: { type: "stdio", command: "bash", args: [OLD, "npx", PKG], env: { A: "1" } },
      mempalace: { type: "http", command: "bash", args: [OLD, "x"] },
    });
    const calls: string[][] = [];
    const ctx = { io: { out: () => {} }, ...env, home } as Parameters<
      typeof upgradeLegacyClaudeEntries
    >[0];
    assert.deepEqual(upgradeLegacyClaudeEntries(ctx, fakeClaude(file, calls)), []);
    assert.deepEqual(calls, []);
  });
});

describe("Gemini CLI settings.json", () => {
  const seed = {
    context: { fileName: ["GEMINI.md"] },
    mcpServers: {
      mempalace: {
        command: "x",
        args: ["__CREWRIG_REPO_DIR__/scripts/lib/mempalace-http-wrapper.py"],
      },
      sequentialthinking: { command: "npx", args: ["-y", "seq"] },
    },
  };
  const current = JSON.stringify({
    mcpServers: {
      playwright: { command: "bash", args: [OLD, "npx", PKG] },
      mempalace: { command: "bash", args: [OLD, "/py", "/w.py"] },
      sequentialthinking: { command: "bash", args: [OLD, "npx", "-y", "seq"] },
    },
  });

  it("rewrites the reserved entries and the playwright entry, and a second merge is byte-equal", () => {
    const input = { seed, repoDir: REPO, python: "/py", target: "/t/settings.json" };
    const first = mergeGeminiSettings({ ...input, current });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.ok(!first.text.includes("tls-exec.sh"), first.text);
    const doc = parseJson(first.text, "settings.json") as Map<string, Map<string, JsonValue>>;
    const servers = doc.get("mcpServers") as Map<string, Map<string, JsonValue>>;
    for (const name of ["playwright", "mempalace", "sequentialthinking"]) {
      assert.equal(servers.get(name)?.get("command"), "node", name);
      assert.equal((servers.get(name)?.get("args") as string[])[0], NEW, name);
    }
    const second = mergeGeminiSettings({ ...input, current: first.text });
    assert.equal(second.ok && second.text, first.text);
  });
});

describe("Copilot CLI and Antigravity CLI MCP merge", () => {
  it("rewrites a captured legacy playwright entry and keeps an operator entry", () => {
    const captured = parseJson(
      JSON.stringify({
        playwright: { type: "stdio", command: "bash", args: [OLD, "npx", PKG] },
        mine: { command: "bash", args: ["/x/my-wrapper.sh"] },
      }),
      "captured",
    );
    const ctx = { io: { out: () => {} } } as unknown as Parameters<
      typeof mergePreexistingMcpServers
    >[0];
    const config = new Map<string, JsonValue>([["mcpServers", new Map()]]);
    const merged = mergePreexistingMcpServers(
      ctx,
      { servers: captured, backup: "" },
      config,
      prefix,
    );
    const servers = merged.get("mcpServers") as Map<string, Map<string, JsonValue>>;
    assert.equal(servers.get("playwright")?.get("command"), "node");
    assert.deepEqual(servers.get("playwright")?.get("args"), [NEW, "npx", PKG]);
    assert.equal(servers.get("playwright")?.get("type"), "stdio");
    assert.deepEqual(servers.get("mine")?.get("args"), ["/x/my-wrapper.sh"]);
    const again = mergePreexistingMcpServers(
      ctx,
      { servers: merged.get("mcpServers") as JsonValue, backup: "" },
      new Map<string, JsonValue>([["mcpServers", new Map()]]),
      prefix,
    );
    assert.deepEqual(again, merged);
  });
});

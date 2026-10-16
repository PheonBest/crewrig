// setup-mcp-merge-policy.test.ts — the pre-existing MCP-server preservation policy (spec 0089 R2-R9,
// spec 0245 R17), asserted over the fixtures of the Bash suite test-setup-mcp-merge.sh sections 1,
// 2 and 2c, through `mergePreexistingMcpServers` (the twin of `merge_preexisting_mcp_servers`).

import assert from "node:assert/strict";
import test from "node:test";

import { writeJsonText } from "../lib/extension/json-write.ts";
import type { JsonValue } from "../lib/extension/types.ts";
import { mergePreexistingMcpServers, toJsonValue } from "../lib/setup/mcp-json-writers.ts";

const OP_ACME = {
  command: "acme",
  args: ["--serve", "--port", "9999"],
  env: { ACME_TOKEN: "xyz" },
};
const OP_GH = {
  command: "gh-ent",
  args: ["mcp", "--stdio"],
  env: { GITHUB_HOST: "ghe.corp.example" },
};
const OP_MEM = { command: "python", args: ["-m", "legacy_mempalace"] };
const OP_SEQ = { command: "node", args: ["legacy-seqthink.js"] };
const FW_GH = {
  command: "docker",
  args: ["run", "ghcr.io/github/github-mcp-server"],
  env: { Authorization: "Bearer $GITHUB_PAT" },
};
const FW_MEM = {
  command: "bash",
  args: ["/repo/scripts/lib/tls-exec.sh", "/py", "/repo/scripts/lib/mempalace-http-wrapper.py"],
};
const FW_SEQ = {
  command: "bash",
  args: [
    "/repo/scripts/lib/tls-exec.sh",
    "npx",
    "-y",
    "@modelcontextprotocol/server-sequential-thinking",
  ],
};
const PW_COPILOT = {
  type: "stdio",
  command: "bash",
  args: ["/repo/scripts/lib/tls-exec.sh", "npx", "@playwright/mcp@latest"],
};
const PW_AGY = {
  command: "bash",
  args: ["/repo/scripts/lib/tls-exec.sh", "npx", "@playwright/mcp@latest"],
};
const BACKUP_REF = "/tmp/x/config.json.bak.20260722-000000";

type Servers = Record<string, unknown>;

function run(framework: Servers, pre: Servers) {
  const out: string[] = [];
  const ctx = { io: { out: (l: string) => void out.push(l) } } as Parameters<
    typeof mergePreexistingMcpServers
  >[0];
  const config = new Map<string, JsonValue>([["mcpServers", toJsonValue(framework)]]);
  const merged = mergePreexistingMcpServers(
    ctx,
    { servers: toJsonValue(pre), backup: BACKUP_REF },
    config,
  );
  const servers = merged.get("mcpServers") as Map<string, JsonValue>;
  const text = out.join("\n");
  return {
    // verbatim: same keys, same order, same values
    is: (name: string, expected: unknown) =>
      assert.equal(
        servers.has(name) ? writeJsonText(servers.get(name) as JsonValue) : undefined,
        writeJsonText(toJsonValue(expected)),
        `'${name}' must equal the expected declaration byte for byte`,
      ),
    absent: (name: string) => assert.equal(servers.has(name), false, `'${name}' must be absent`),
    warned: (name: string) => {
      assert.match(text, new RegExp(`'${name}'`));
      assert.ok(text.includes(BACKUP_REF), "the warning points at the backup");
    },
    quiet: (name: string) => assert.doesNotMatch(text, new RegExp(`'${name}'`)),
    text,
  };
}

test("shape A, selection collision: operator servers win, the reserved framework entry wins, one warning", () => {
  const r = run(
    { github: FW_GH, mempalace: FW_MEM, sequentialthinking: FW_SEQ },
    { "acme-tools": OP_ACME, github: OP_GH, mempalace: OP_MEM },
  );
  r.is("acme-tools", OP_ACME);
  r.is("github", OP_GH);
  r.is("mempalace", FW_MEM);
  r.is("sequentialthinking", FW_SEQ);
  r.warned("mempalace");
  r.quiet("sequentialthinking");
  assert.match(r.text, /replaced \(framework wins\)/);
});

test("shape A, declined reserved server: removed, the non-reserved declaration is kept, warning", () => {
  const r = run(
    { github: FW_GH, sequentialthinking: FW_SEQ },
    { "acme-tools": OP_ACME, mempalace: OP_MEM },
  );
  r.is("acme-tools", OP_ACME);
  r.absent("mempalace");
  r.warned("mempalace");
  assert.match(r.text, /removed \(you declined it\)/);
});

test("shape B, selection collision on sequentialthinking: framework wins, warning only for it", () => {
  const r = run(
    { mempalace: FW_MEM, sequentialthinking: FW_SEQ },
    { "acme-tools": OP_ACME, sequentialthinking: OP_SEQ },
  );
  r.is("acme-tools", OP_ACME);
  r.is("sequentialthinking", FW_SEQ);
  r.warned("sequentialthinking");
  r.quiet("mempalace");
});

test("shape B, both reserved declined over an empty framework map: both removed and warned, acme kept", () => {
  const r = run({}, { "acme-tools": OP_ACME, mempalace: OP_MEM, sequentialthinking: OP_SEQ });
  r.is("acme-tools", OP_ACME);
  r.absent("mempalace");
  r.absent("sequentialthinking");
  r.warned("mempalace");
  r.warned("sequentialthinking");
});

test("spec 0245 R17: a wrapped-form playwright entry survives verbatim, silently (copilot and antigravity forms)", () => {
  const copilot = run(
    { github: FW_GH, mempalace: FW_MEM, sequentialthinking: FW_SEQ },
    { playwright: PW_COPILOT, sequentialthinking: OP_SEQ },
  );
  copilot.is("playwright", PW_COPILOT);
  copilot.quiet("playwright");
  const agy = run({ mempalace: FW_MEM, sequentialthinking: FW_SEQ }, { playwright: PW_AGY });
  agy.is("playwright", PW_AGY);
  agy.quiet("playwright");
});

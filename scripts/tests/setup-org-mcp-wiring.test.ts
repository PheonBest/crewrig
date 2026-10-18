// setup-org-mcp-wiring.test.ts — the shipped org manifest (spec 0263,
// ported from test-setup-org-mcp.sh group 1 tail; the gemini fold order of group 7 is pinned by
// setup-gemini-settings.test.ts, the shell text it read being gone, spec 0266). Group 6 (the declared sub-step order
// per CLI) is NOT re-asserted: setup-retarget-others.test.ts "org fold per CLI" pins all four pairs.
// Runs on every platform: a JSON read, a text read.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { REPO } from "./lib/worktree-fixtures.ts";

const SHIPPED = path.join(REPO, "mcp-servers.org.json");

function strings(value: unknown, into: string[] = []): string[] {
  if (typeof value === "string") into.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, into);
  else if (value !== null && typeof value === "object") {
    for (const v of Object.values(value)) strings(v, into);
  }
  return into;
}

describe("the shipped mcp-servers.org.json is an empty operational channel (R9)", () => {
  test("the file exists (spec 0091 back-fill) and its .mcpServers reads to {}", () => {
    assert.ok(fs.existsSync(SHIPPED), "shipped mcp-servers.org.json missing");
    const parsed = JSON.parse(fs.readFileSync(SHIPPED, "utf8")) as { mcpServers?: unknown };
    assert.deepEqual(parsed.mcpServers ?? {}, {});
  });
  test("no string anywhere in it looks like a literal bearer credential", () => {
    const all = strings(JSON.parse(fs.readFileSync(SHIPPED, "utf8")));
    assert.ok(all.length > 0, "vacuity guard: the walk saw no string");
    const leaks = all.filter((s) => /Bearer [A-Za-z0-9]{12,}/.test(s));
    assert.deepEqual(leaks, []);
  });
});

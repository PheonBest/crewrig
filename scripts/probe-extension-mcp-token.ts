#!/usr/bin/env node
// probe-extension-mcp-token.ts — TypeScript twin of probe-extension-mcp-token.sh (spec 0261): re-establish,
// against the installed vendor binaries, how each CLI resolves an extension MCP server's path token and a
// name collision (spec 0180 R9/R13). Usage: node scripts/probe-extension-mcp-token.ts [q1|q2q3|q4|all].
// Exit: 0 definite answers, 1 precondition failure, 2 inconclusive. See docs/runbooks/extension-mcp-token-probe.md.

import { runProbe } from "./lib/probe-extension-mcp-token/run.ts";

const env: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;

process.exitCode = runProbe({
  args: process.argv.slice(2),
  env,
  cwd: process.cwd(),
  io: {
    out: (text) => void process.stdout.write(text),
    err: (text) => void process.stderr.write(text),
  },
  argv0: process.argv[1] ?? "probe-extension-mcp-token.ts",
});

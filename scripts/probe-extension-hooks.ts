// probe-extension-hooks.ts — thin entry of the four-target extension-hook probe (spec 0179
// issue #1005, twin of probe-extension-hooks.sh). Not a CI gate: it needs all four CLIs installed
// and authenticated, and the Copilot arm spends real credits on live tool-invoking turns.
//
//   node scripts/probe-extension-hooks.ts
//
// Environment seams: COPILOT_BIN, CLAUDE_BIN, PROBE_COPILOT_TIMEOUT (seconds, default 120).
// Exit status: 0 every arm completed (B1A, B2 and B3 are all valid outcomes), 1 a binary is missing.

import { runProbe } from "./lib/probe-extension-hooks/run.ts";

const env: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;

process.exitCode = runProbe({
  env,
  cwd: process.cwd(),
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
});

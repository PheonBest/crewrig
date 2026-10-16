// check-extension-pivot.ts — every upstream-owned extension command, agent and skill is authored in the pivot format.
// Twin of scripts/check-extension-pivot.sh (spec 0259).
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-extension-pivot.ts
// Paths are relative to the current directory (extensions/core, extensions/library).
//
// Exit: 0 when clean, 1 on a finding (orphan command .toml or agent directory without AGENT.md).
// Output: per-component `  OK   <path>` / `  FAIL <path> — <reason>` lines, then a
// summary block, all on stdout.

import { checkPivot } from "./lib/governance/ext-pivot.ts";
import { ok } from "./lib/governance/report.ts";

const { lines, code } = checkPivot();
for (const line of lines) ok(line);
process.exitCode = code;

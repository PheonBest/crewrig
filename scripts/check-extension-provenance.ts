// check-extension-provenance.ts — every upstream-owned extension skill/agent carries a complete, self-routing crewrig-provenance carrier.
// Twin of scripts/check-extension-provenance.sh (spec 0259).
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-extension-provenance.ts
// Paths are relative to the current directory (extensions/core, extensions/library).
//
// Exit: 0 when clean, 1 on a finding (R1/R5/R7 findings).
// Output: per-component `  OK   <path>` / `  FAIL <path> — <reason>` lines, then a
// summary block, all on stdout.

import { checkProvenance } from "./lib/governance/ext-provenance.ts";
import { ok } from "./lib/governance/report.ts";

const { lines, code } = checkProvenance();
for (const line of lines) ok(line);
process.exitCode = code;

// check-agents-size.ts — fails CI if AGENTS.md meets or exceeds 19 100 bytes.
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-agents-size.ts [path]
// `path` defaults to AGENTS.md (relative to the current directory).
//
// Exit: 0 under the threshold, 1 at or over it or the file is unreadable.
// Output: `OK: AGENTS.md is <n> bytes (threshold: 19100 bytes)` on stdout, or the
// two `ERROR:` lines on stderr; an unreadable file prints one
// `Error: <path>: <reason>` line on stderr (spec 0259 deviation (d)).

import { evaluateSize } from "./lib/governance/agents-size.ts";
import { fatal, ok } from "./lib/governance/report.ts";

const outcome = evaluateSize(process.argv[2] ?? "AGENTS.md");
if (outcome.stdout !== "") ok(outcome.stdout.replace(/\n$/, ""));
if (outcome.stderr !== "") fatal(outcome.stderr.replace(/\n$/, ""));
process.exitCode = outcome.code;

// check-rules-size.ts — fails CI if the always-loaded core rules meet or exceed
// 27 800 bytes in total (spec 0270).
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-rules-size.ts [dir]
// `dir` defaults to artifacts/core/rules (relative to the current directory).
//
// Exit: 0 under the budget, 1 at or over it, the directory is unreadable, or it
// holds no `.md` file (fail closed).
// Output: `OK: core rules total <n> bytes across <k> file(s) (budget: 27800 bytes)`
// on stdout, or the `ERROR:` / `Error:` lines on stderr.

import { evaluateRulesSize } from "./lib/governance/rules-size.ts";
import { fatal, ok } from "./lib/governance/report.ts";

const outcome = evaluateRulesSize(process.argv[2] ?? "artifacts/core/rules");
if (outcome.stdout !== "") ok(outcome.stdout.replace(/\n$/, ""));
if (outcome.stderr !== "") fatal(outcome.stderr.replace(/\n$/, ""));
process.exitCode = outcome.code;

// check-test-wiring.ts — fails CI when a scripts/tests/test-*.sh script runs in no CI
// workflow and is not exempted with a reason (spec 0076, spec 0259).
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-test-wiring.ts
// CREWRIG_REPO_DIR overrides the repository root (default: the root of this script).
//
// Exit: 0 clean, 1 findings (or an unreadable input), 2 tests directory not found
// (`Error: tests directory not found: <dir>` on stderr).
// Findings: three `FAILED:` blocks on stderr (orphans, reasonless exemptions, stale
// exemptions); success is one `OK:` line on stdout.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { fatal, ok } from "./lib/governance/report.ts";
import { evaluateWiring } from "./lib/governance/test-wiring.ts";

const repo = process.env.CREWRIG_REPO_DIR
  ? process.env.CREWRIG_REPO_DIR
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

try {
  const outcome = evaluateWiring(repo);
  if (outcome.stdout !== "") ok(outcome.stdout.replace(/\n$/, ""));
  if (outcome.stderr !== "") fatal(outcome.stderr.replace(/\n$/, ""));
  process.exitCode = outcome.code;
} catch (err) {
  fatal(`Error: ${(err as Error).message}`);
  process.exitCode = 1;
}

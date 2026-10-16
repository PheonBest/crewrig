// check-test-strays.ts — static syntax guard for the Bash test suites (issue #738).
//
// Usage: node scripts/check-test-strays.ts [--base-ref REF] [--cache-dir DIR] [--jobs N]
// The three options each take a value and are ignored; any other argument is a
// usage error. CREWRIG_REPO_DIR overrides the repository root.
//
// Exit: 0 clean or skipped on win32, 1 syntax error in a suite, 2 usage error,
// missing tests directory or missing bash.
// Output: one `OK:` line on stdout (or one `SKIP:` line on win32); a syntax
// error prints `FAILED: <suite> has syntax errors:` and Bash's text on stderr.

import path from "node:path";
import { fileURLToPath } from "node:url";

import { runTestStrays } from "./lib/governance/test-strays.ts";
import { fatal, ok } from "./lib/governance/report.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoDir =
  process.env.CREWRIG_REPO_DIR !== undefined && process.env.CREWRIG_REPO_DIR !== ""
    ? process.env.CREWRIG_REPO_DIR
    : path.resolve(here, "..");

const outcome = runTestStrays(process.argv.slice(2), { repoDir });
if (outcome.stdout !== "") ok(outcome.stdout.replace(/\n$/, ""));
if (outcome.stderr !== "") fatal(outcome.stderr.replace(/\n$/, ""));
process.exitCode = outcome.code;

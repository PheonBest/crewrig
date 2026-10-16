// check-no-machine-paths.ts — reject machine-specific home paths in tracked files
// (spec 0081 R5/R6; twin of check-no-machine-paths.sh, spec 0259).
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-no-machine-paths.ts
// The repository is CREWRIG_REPO_DIR when set, else the parent of scripts/.
//
// Exit: 0 when no non-benign `/Users/<owner>/` or `/home/<owner>/` path is tracked
// (prints the OK line on stdout), 1 otherwise.
// Finding-line format: `<path>:<line>: <token>` on stderr, then the FAILED block.
// Benign owners: `agent` (any form), `ana` (drive-letter /Users/ form only).

import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateMachinePaths } from "./lib/governance/machine-paths.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoDir = process.env["CREWRIG_REPO_DIR"] || path.resolve(here, "..");
const outcome = evaluateMachinePaths(repoDir);
// Bytes, not strings: tracked paths are not necessarily UTF-8 (decoded as latin1 upstream).
if (outcome.stdout !== "") process.stdout.write(outcome.stdout);
if (outcome.stderr.length > 0) process.stderr.write(outcome.stderr);
process.exitCode = outcome.code;

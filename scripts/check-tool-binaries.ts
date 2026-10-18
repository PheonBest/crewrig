// check-tool-binaries.ts — fail when a repository-local npm tool binary is missing (spec 0266 R13).
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-tool-binaries.ts <tool>...
// Looks under <repo>/node_modules/.bin (the parent of scripts/, or CREWRIG_REPO_DIR when set); on
// Windows it accepts the `.cmd` shim npm writes. Exit: 0 all present, 1 some missing (named on
// stderr), 2 no tool named.

import path from "node:path";
import { missingTools } from "./lib/tool-binaries.ts";

const tools = process.argv.slice(2);
const envDir = process.env["CREWRIG_REPO_DIR"];
const repoDir =
  envDir !== undefined && envDir !== "" ? envDir : path.resolve(import.meta.dirname, "..");

if (tools.length === 0) {
  process.stderr.write("usage: check-tool-binaries.ts <tool>...\n");
  process.exitCode = 2;
} else {
  const missing = missingTools(repoDir, tools);
  if (missing.length > 0) {
    process.stderr.write(`missing under node_modules/.bin: ${missing.join(", ")}\n`);
    process.exitCode = 1;
  }
}

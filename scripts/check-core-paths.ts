// check-core-paths.ts — keep the core-paths manifest and the tree in agreement,
// in both directions (specs 0031 R5, 0121 R5, 0199 R41; spec 0259 req 12).
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-core-paths.ts
// `CREWRIG_REPO_DIR` (when non-empty) names the repository; default: the parent of
// this script's directory.
//
// Exit: 0 both directions agree, 1 a manifest entry does not resolve at HEAD or a
// built-output directory or supported target carries no guarantee, 2 the manifest or
// the builder is missing, or the builder's `--list-output-dirs` query failed.
// Finding lines (stderr): `  FAIL <path> (<policy>) — ...`, then `  - <item>` lists.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCorePaths } from "./lib/governance/core-paths.ts";
import { fatal, ok } from "./lib/governance/report.ts";

const fromEnv = process.env.CREWRIG_REPO_DIR;
const repoDir =
  fromEnv !== undefined && fromEnv !== ""
    ? fromEnv
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const result = runCorePaths(repoDir);
for (const line of result.lines) (line.stream === "stdout" ? ok : fatal)(line.text);
process.exitCode = result.code;

// check-component-metadata-keys.ts — closed-key checker for the `metadata:` block of
// an upstream-owned component source (spec 0200 R8-R12; TypeScript twin, spec 0259).
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-component-metadata-keys.ts [<file> ...]
// With no argument it checks every artifacts/{core,library} skill, command and agent
// source under CREWRIG_REPO_DIR (default: this repository); with arguments, those files
// (a file outside artifacts/core/ and artifacts/library/ is reported clean unread).
//
// Deviation (e): a duplicated mapping key in a governed front matter is a rejection
// (`Error: <file>: duplicated mapping key in front matter` on stderr), not a pass.
// Exit: 0 clean, 1 rejections, 2 prerequisite or input failure.
// Finding lines (stderr): `<file>: K1 metadata.<key> is not admitted ...`, then `FAILED: ...`.

import path from "node:path";
import { checkMetadataKeys } from "./lib/governance/metadata-keys.ts";
import { fatal, ok } from "./lib/governance/report.ts";
import { repoRootFrom } from "./lib/paths.ts";
import { MissingDependencyError, loadDependency } from "./lib/require-dependency.ts";

const envRoot = process.env["CREWRIG_REPO_DIR"];
const repoDir =
  envRoot !== undefined && envRoot !== "" ? envRoot : path.resolve(repoRootFrom(import.meta.url));

try {
  const outcome = checkMetadataKeys({
    args: process.argv.slice(2),
    repoDir,
    yamlNamespace: await loadDependency("js-yaml"),
  });
  if (outcome.stdout !== "") ok(outcome.stdout.replace(/\n$/, ""));
  if (outcome.stderr !== "") fatal(outcome.stderr.replace(/\n$/, ""));
  process.exitCode = outcome.code;
} catch (err) {
  if (!(err instanceof MissingDependencyError)) throw err;
  fatal(err.message);
  process.exitCode = 2;
}

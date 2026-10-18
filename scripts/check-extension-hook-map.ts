// check-extension-hook-map.ts — the R6 agreement check (spec 0179, spec 0259): asserts that
// docs/extension-hook-events.md and the extension hook translator agree, from two independent
// representations (the published table and the translator's own rendered probe), and that the
// per-target header cells match scripts/lib/extension-targets.json.
//
// Usage: node scripts/check-extension-hook-map.ts
// Paths resolve from this file's own location (not the working directory).
//
// Exit: 0 agreement, 1 at least one disagreement, 2 the doc is missing (stderr).
// Output (stdout): `  FAIL ...` finding lines, a blank line and
// `FAILED: <n> disagreement(s) between ...`, or the single `OK: ...` line.

import fs from "node:fs";
import path from "node:path";
import { checkHookMap } from "./lib/governance/hook-map.ts";
import { fatal, ok } from "./lib/governance/report.ts";

const repoDir = path.resolve(import.meta.dirname, "..");
const doc = path.join(repoDir, "docs", "extension-hook-events.md");

if (!fs.existsSync(doc) || !fs.statSync(doc).isFile()) {
  fatal(`Error: ${doc} not found.`);
  process.exitCode = 2;
} else {
  const result = checkHookMap(
    fs.readFileSync(doc, "utf8"),
    doc,
    path.join(repoDir, "scripts", "lib"),
  );
  for (const line of result.out) ok(line);
  process.exitCode = result.code;
}

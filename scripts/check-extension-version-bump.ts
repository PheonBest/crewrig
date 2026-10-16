// check-extension-version-bump.ts — enforce the version-bump rule on upstream
// extension skill/agent sources (spec 0044; TypeScript twin, spec 0259).
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-extension-version-bump.ts [<base-ref>]
// The base ref comes from the argument, else BASE_REF, else `<remote>/main`
// (falling back to `<remote>/develop`). A value ending in `/` counts as unset.
//
// Exit: 0 all modified sources bumped or exempt, 1 at least one failure,
// 2 the base ref cannot be resolved or fetched.
// Finding lines (stdout): `  FAIL <path> — <reason>`; passing lines `  OK   <path> ...`.

import { runVersionBump } from "./lib/governance/ext-version-bump.ts";
import { fatal, ok } from "./lib/governance/report.ts";

const outcome = runVersionBump(process.argv[2] || process.env.BASE_REF || "");
for (const line of outcome.stdout) ok(line);
for (const line of outcome.stderr) fatal(line);
process.exitCode = outcome.code;

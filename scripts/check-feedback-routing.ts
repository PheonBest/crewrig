// check-feedback-routing.ts — upstream-tier feedback-routing invariant (spec 0030;
// TypeScript twin, spec 0259).
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-feedback-routing.ts
// Run from the repository root: the tier roots (artifacts/core, artifacts/library,
// extensions/core, extensions/library) are read relative to the working directory.
//
// Deviation (e): a duplicated mapping key in a front matter is a FAIL line, not a skip.
// Exit: 0 every source with a feedback declaration routes to canonical, 1 offenders.
// Output (all on stdout): `  OK   <file>` / `  FAIL <file> — feedback '<f>' != canonical '<c>'`
// per source, then the summary or the FAILED block.

import { checkFeedbackRouting } from "./lib/governance/feedback-routing.ts";
import { fatal, ok } from "./lib/governance/report.ts";
import { MissingDependencyError, loadDependency } from "./lib/require-dependency.ts";

try {
  const outcome = checkFeedbackRouting({ yamlNamespace: await loadDependency("js-yaml") });
  if (outcome.stdout !== "") ok(outcome.stdout.replace(/\n$/, ""));
  if (outcome.stderr !== "") fatal(outcome.stderr.replace(/\n$/, ""));
  process.exitCode = outcome.code;
} catch (err) {
  if (!(err instanceof MissingDependencyError)) throw err;
  fatal(err.message);
  process.exitCode = 2;
}

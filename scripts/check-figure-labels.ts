// check-figure-labels.ts — verify figure PNG labels against their sidecar prompts using
// OCR (spec 0156 / issue #881; TypeScript twin per spec 0259 requirement 17).
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-figure-labels.ts
// Arguments are ignored. The repository root is the parent of this script's directory.
// Needs the `tesseract` binary; absent, prints a `[SKIP]` note and exits 0.
//
// Exit: 0 all figures passed, nothing to check, or tesseract absent; 1 a figure failed.
// Finding lines (stdout): `  ❌ [FAIL] Missing label: '<label>'`,
// `  ❌ [FAIL] Label out of order: '<label>' found at cluster <i> (x=<n>px), expected after cluster <j>`,
// a `[FAIL] <k>/<n> figure(s) failed label OCR verification.` summary.

import path from "node:path";
import {
  checkFigureLabels,
  SKIP_NOTE,
  tesseractAvailable,
} from "./lib/governance/figure-labels.ts";
import { ok } from "./lib/governance/report.ts";

if (!tesseractAvailable()) {
  ok(SKIP_NOTE);
} else {
  const outcome = checkFigureLabels(path.resolve(import.meta.dirname, ".."));
  for (const line of outcome.lines) ok(line);
  process.exitCode = outcome.code;
}

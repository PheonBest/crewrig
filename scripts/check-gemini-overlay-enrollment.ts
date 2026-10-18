// check-gemini-overlay-enrollment.ts — fail CI when a deployed Gemini overlay is not enrolled
// in the context manifest (spec 0085; TypeScript twin of check-gemini-overlay-enrollment.sh).
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-gemini-overlay-enrollment.ts
// Override the repository root with CREWRIG_REPO_DIR (default: the parent of scripts/).
//
// Exit: 0 every deployed overlay is enrolled (OK line on stdout), 1 an overlay is deployed but
// not enrolled, 2 usage or internal error (missing source, unparseable declaration).
// Finding lines: `  - <overlay>` under a `FAILED:` or `WARNING:` heading, on stderr.

import path from "node:path";
import { checkEnrollment } from "./lib/governance/gemini-overlay.ts";
import { fatal, ok } from "./lib/governance/report.ts";

const envDir = process.env["CREWRIG_REPO_DIR"];
const repoDir =
  envDir !== undefined && envDir !== "" ? envDir : path.resolve(import.meta.dirname, "..");
process.exitCode = checkEnrollment(repoDir, { out: ok, err: fatal });

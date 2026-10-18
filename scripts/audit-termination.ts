// audit-termination.ts — prepares the R25 termination audit of epic #1231 (spec 0266 R17-R19,
// parent spec 0215 requirement 25). Prints a Markdown report to stdout; never writes into the repo.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/audit-termination.ts [--merge-rehearsal] > report.md
//
// Reads the repository (git ls-files, files), the forge through `gh` reads, and rehearses the sync
// recovery inside a mkdtemp clone. Exit 1 when a self-check fails (for instance a row 37g cell that
// reads measured, since nobody has measured #1601); exit 2 on a usage or wiring fault.

import { tmpdir } from "node:os";
import { realRun } from "./lib/audit-termination/exec.ts";
import { buildReport } from "./lib/audit-termination/report.ts";
import { makeLog } from "./lib/audit-termination/types.ts";
import { WiringError, repoRoot } from "./lib/ts-scope.ts";

const args = process.argv.slice(2);
const known = new Set(["--merge-rehearsal"]);
const bad = args.filter((a) => !known.has(a));
if (bad.length > 0) {
  process.stderr.write(
    `audit-termination: unknown argument ${bad.join(" ")}\nusage: audit-termination.ts [--merge-rehearsal]\n`,
  );
  process.exit(2);
}

try {
  const root = repoRoot();
  const logger = makeLog();
  const result = buildReport(
    { root, run: realRun(logger.log), log: logger.log, lines: logger.lines, tmpBase: tmpdir() },
    args.includes("--merge-rehearsal"),
  );
  process.stdout.write(result.markdown);
  if (result.failures.length > 0) {
    process.stderr.write(`audit-termination: self-check FAILED: ${result.failures.join("; ")}\n`);
    process.exitCode = 1;
  }
} catch (e) {
  if (!(e instanceof WiringError)) throw e;
  process.stderr.write(`audit-termination: wiring fault: ${e.message}\n`);
  process.exitCode = 2;
}

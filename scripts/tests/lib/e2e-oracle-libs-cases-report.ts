// e2e-oracle-libs-cases-report.ts — cases of tests/e2e/lib/report.sh run as a script, plus the
// toml_merge group (spec 0261 R9). Inventory: test-e2e-report.sh cases 3-8. Every case passes
// `--dry-run` or fails early: the non-dry-run report names its file `parity-<date>-<time>.md` from
// the wall clock, which a script-mode LibCase cannot pin (reported to the lead).

import type { LibCase } from "./e2e-oracle-libs-types.ts";
import { cases as tomlCases } from "./e2e-oracle-libs-cases-toml.ts";

const LIB = "tests/e2e/lib/report.sh";
const T = "TAP version 13\n";

const report = (
  id: string,
  files: Record<string, string>,
  args: string[],
  extra: Partial<LibCase> = {},
): LibCase => ({
  id: `report/${id}`,
  lib: LIB,
  fn: "",
  script: true,
  args,
  seed: Object.entries(files).map(([p, content]) => ({ path: p, content })),
  ...extra,
});
const DRY = ["--tap-dir", "taps", "--output-dir", "out", "--dry-run"];

export const cases: LibCase[] = [
  ...tomlCases,
  report("empty-dir-exit-2", { "taps/.keep": "" }, DRY),
  report("missing-tap-dir", {}, DRY),
  report(
    "single-ok",
    { "taps/run-001/run.tap": `${T}1..1\nok 1 - claude/01-layered-context\n` },
    DRY,
  ),
  report(
    "single-not-ok",
    { "taps/run-001/run.tap": `${T}1..1\nnot ok 1 - claude/01-layered-context\n` },
    DRY,
  ),
  report(
    "skip-directive",
    { "taps/run-001/run.tap": `${T}1..1\nok 1 - copilot/01-layered-context # SKIP no auth\n` },
    DRY,
  ),
  report(
    "todo-directive-upper",
    { "taps/r/run.tap": `${T}ok 1 - gemini/s1 # TODO later\nok 2 - claude/s1 # Skipped x\n` },
    DRY,
  ),
  report(
    "not-ok-with-skip-directive",
    { "taps/r/run.tap": `${T}not ok 1 - claude/s1 # SKIP x\n` },
    DRY,
  ),
  report(
    "full-matrix",
    {
      "taps/r/run.tap": `${T}ok 1 - claude/b-scn\nnot ok 2 - gemini/b-scn\nok 3 - copilot/a-scenario-with-a-long-name\n# comment\nbad line\nok 4 - nodash\nok 5 - claude\n`,
    },
    DRY,
  ),
  report(
    "newest-file-wins",
    {
      "taps/20260101T000000Z-aaaa/run.tap": `${T}not ok 1 - claude/s1\n`,
      "taps/20260102T000000Z-bbbb/run.tap": `${T}ok 1 - claude/s1\n`,
    },
    DRY,
  ),
  report(
    "older-file-fails-newer-lacks-cell",
    {
      "taps/a/run.tap": `${T}not ok 1 - claude/s1\n`,
      "taps/b/run.tap": `${T}ok 1 - gemini/s1\n`,
    },
    DRY,
  ),
  report(
    "top-level-tap-and-nested",
    {
      "taps/x.tap": `${T}ok 1 - claude/s1\n`,
      "taps/d/y.tap": `${T}ok 1 - copilot/s2\n`,
      "taps/ignored.txt": "ok 1 - claude/s9\n",
    },
    DRY,
  ),
  report("crlf-tap", { "taps/r/run.tap": `TAP version 13\r\n1..1\r\nok 1 - claude/s1\r\n` }, DRY),
  report("description-whitespace", { "taps/r/run.tap": `${T}ok 1 -   claude/s1   \n` }, DRY),
  report("help", {}, ["--help"]),
  report("help-short", {}, ["-h"]),
  report("unknown-flag", {}, ["--bogus"]),
  report("default-tap-dir-absent", {}, ["--dry-run"]),
  report("default-dirs-dry-run", { "tests/e2e/reports/r/run.tap": `${T}ok 1 - claude/s1\n` }, [
    "--dry-run",
  ]),
];

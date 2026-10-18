// e2e-oracle-cases-02-04.ts — oracle cases of scenarios 02-cross-tool-memory (claude, gemini) and
// 04-harness-loop (claude, gemini, copilot), the `applies_to` of tests/e2e/defaults.toml.
//
// Both scenarios make the same docker calls, in this order (the stand-in answers `volume create`,
// `volume rm` and `rm -f` itself and only consumes an ordinal for them when a fixture `match`es):
//   ordinal 0  docker run -d ... sleep 600     the MemPalace sidecar
//   ordinal 1  docker run --rm ...             the writer (02) / harness-report step (04)
//   ordinal 2  docker run --rm ...             the reader (02) / harness-curator search (04)
// A fixture matching `volume create` (exit 1) takes ordinal 0 for the volume-failure skip case.
// Neither scenario calls `gh` or `git`: no stub tool is needed.

import fs from "node:fs";
import path from "node:path";

import type { FixtureEntry } from "./e2e-docker-standin.ts";
import type { OracleCase, SeedContext } from "./e2e-oracle-types.ts";

const CLIS_02 = ["claude", "gemini"] as const;
const CLIS_04 = ["claude", "gemini", "copilot"] as const;
const S02 = "02-cross-tool-memory";
const S04 = "04-harness-loop";
const JUDGE_PASS = "VERDICT=PASS CONF=0.95";
const JUDGE_FAIL = "VERDICT=FAIL CONF=0.90";

/** A dummy credential marker so the runner's auth gate lets the scenario run. */
function seedBundle(ctx: SeedContext): void {
  const dir = path.join(ctx.e2eHome, ctx.cli);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, ".credentials.json"), '{"dummy":true}\n');
}

const SIDECAR_OK: FixtureEntry = { match: ["run", "-d"], stdout: "sidecar-id\n" };
const RUN_OK: FixtureEntry = { match: ["run"] };
const VOLUME_FAILS: FixtureEntry = {
  match: ["volume", "create"],
  exit: 1,
  stderr: "volume create failed\n",
};

function build(
  scenario: string,
  cli: string,
  variant: string,
  fixtures: readonly FixtureEntry[],
  expectedExit: number,
  judgeMockResponse?: string,
): OracleCase {
  return {
    id: `${scenario}/${cli}/${variant}`,
    scenario,
    cli,
    variant,
    fixtures,
    seed: seedBundle,
    expectedExit,
    ...(judgeMockResponse === undefined ? {} : { judgeMockResponse }),
  };
}

function crossToolMemory(cli: string): OracleCase[] {
  const writer: FixtureEntry = { ...RUN_OK, stdout: "RESULT: {'success': True}\n" };
  const reader = (stdout: string, exit = 0): FixtureEntry => ({ ...RUN_OK, stdout, exit });
  const found = reader(
    `[TASK:ongoing] e2e-02-cross-tool | cross-tool handoff probe\n\nwriter_agent: ${cli}-writer\n`,
  );
  const one = (variant: string, fixtures: FixtureEntry[], exit: number): OracleCase =>
    build(S02, cli, variant, fixtures, exit);
  return [
    one("pass", [SIDECAR_OK, writer, found], 0),
    // scenario_skip -> exit 78 -> the runner reports a TAP skip, exit 0.
    one("volume-create-skip", [VOLUME_FAILS], 0),
    one("sidecar-start-skip", [{ ...SIDECAR_OK, exit: 125, stderr: "no such image\n" }], 0),
    one("writer-fails", [SIDECAR_OK, { ...writer, exit: 1, stderr: "boom\n" }, found], 1),
    one("reader-fails", [SIDECAR_OK, writer, reader("", 1)], 1),
    one("missing-drawer", [SIDECAR_OK, writer, reader("No results found.\n")], 1),
    one("wrong-answer", [SIDECAR_OK, writer, reader("[TASK:ongoing] only the marker\n")], 1),
  ];
}

function harnessLoop(cli: string): OracleCase[] {
  const report: FixtureEntry = { ...RUN_OK, stdout: "mined 1 drawer\n" };
  const curator = (stdout: string, exit = 0): FixtureEntry => ({ ...RUN_OK, stdout, exit });
  const found = curator("[FRICTION] e2e-04-build-version-drop | silent drop of version\n");
  const one = (
    variant: string,
    fixtures: FixtureEntry[],
    exit: number,
    judge = JUDGE_PASS,
  ): OracleCase => build(S04, cli, variant, fixtures, exit, judge);
  return [
    one("pass", [SIDECAR_OK, report, found], 0),
    one("volume-create-skip", [VOLUME_FAILS], 0),
    one("sidecar-start-skip", [{ ...SIDECAR_OK, exit: 125, stderr: "no such image\n" }], 0),
    one("report-fails", [SIDECAR_OK, { ...report, exit: 1, stderr: "boom\n" }, found], 1),
    one("curator-fails", [SIDECAR_OK, report, curator("", 1)], 1),
    one("missing-drawer", [SIDECAR_OK, report, curator("No results found.\n")], 1),
    one("judge-fail", [SIDECAR_OK, report, found], 1, JUDGE_FAIL),
  ];
}

export const cases: OracleCase[] = [
  ...CLIS_02.flatMap(crossToolMemory),
  ...CLIS_04.flatMap(harnessLoop),
];

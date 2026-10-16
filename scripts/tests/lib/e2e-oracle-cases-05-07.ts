// e2e-oracle-cases-05-07.ts — oracle cases of the probe scenarios 05-copilot-model-routing
// (copilot), 06-agent-surface-consumption (copilot, claude) and 07-guidance-surface (copilot,
// claude), the `applies_to` of tests/e2e/defaults.toml (spec 0261 R8).
//
// What a canned container output can and cannot drive (read from the scenario scripts):
// - Every verdict of these probes hangs on a per-run RANDOM nonce (`od -N8 /dev/urandom`) that the
//   scenario puts in the agent declaration (mounted read-only, deleted after the call) and in the
//   prompt argv (baseline nonce). A fixture cannot know either, so `nonce_observed` and
//   `baseline_observed` are always false: probe B cells resolve `indeterminate`, probe C cells
//   resolve `INDETERMINATE|session-broken-or-unresponsive`, and no passing verdict (`consumed`,
//   `not-consumed`, `IGNORED`, `HONOURED`, `DISTURBED`, `BUG-*`) is reachable. These cases record
//   the unreachable-baseline verdict, the exact ordered docker tuple, and the skip paths.
// - Probes A (05) and C-copilot (07) require `[cli.copilot].byok_provider/byok_model` AND a changed
//   `command` from `tests/e2e/local.toml`, a gitignored file the runner reads from the checkout; the
//   harness cannot seed it. Only the "BYOK not declared" skip is reachable; the "declared but
//   unbacked" skip is not, so 05/copilot and 07/copilot carry skip paths only.
// - A passing verdict needs a stand-in extension: a fixture `stdout` template with tokens for the
//   last argv word (carries the baseline nonce) and for a mounted file by container path (carries the
//   agent nonce), e.g. `{{ARGV_LAST}}` / `{{FILE:/home/agent/workspace/.claude/agents/x.md}}`.
//
// Docker calls, in order (the stand-in answers `image inspect` itself; `run` consumes an ordinal):
//   06  ordinal 0 `run --rm <image> <cli> --version`; then one `run` per cell: copilot nested, flat,
//       cross_cell_control (3 cells); claude nested, flat (2 cells).
//   07  ordinal 0 the version call (copilot/claude); claude then runs C3-control and C3.
// The scenarios exit 0 whatever a cell's docker call returns. A missing credential (empty token,
// no marker) is the runner's own TAP skip: exit 0, no docker call. No stub tool is needed.

import type { FixtureEntry } from "./e2e-docker-standin.ts";
import type { OracleCase } from "./e2e-oracle-types.ts";

const S05 = "05-copilot-model-routing";
const S06 = "06-agent-surface-consumption";
const S07 = "07-guidance-surface";

const CLAUDE_JSON = JSON.stringify({
  result: "done",
  subagent_stats: {
    by_type: { "probe-consumer": { spawned: 1, completed: 1, errored: 0 } },
  },
  modelUsage: { "claude-sonnet-4-6": {} },
});
const COPILOT_TEXT =
  "● Probe-consumer(sonnet) probe\n  └ Agent completed but produced no response.\n";

const RUN: FixtureEntry = { match: ["run"] };
const version = (cli: string): FixtureEntry => ({ ...RUN, stdout: `${cli} 9.9.9\n` });
const cell = (stdout: string, exit = 0, stderr = ""): FixtureEntry => ({
  ...RUN,
  stdout,
  stderr,
  exit,
});

/** Cells each (scenario, cli) pair runs after the version call. */
const CELLS: Readonly<Record<string, number>> = {
  [`${S06}/copilot`]: 3,
  [`${S06}/claude`]: 2,
  [`${S07}/claude`]: 2,
};

function make(
  scenario: string,
  cli: string,
  variant: string,
  fixtures: readonly FixtureEntry[],
  env?: Readonly<Record<string, string>>,
): OracleCase {
  return {
    id: `${scenario}/${cli}/${variant}`,
    scenario,
    cli,
    variant,
    fixtures,
    ...(env === undefined ? {} : { env }),
    expectedExit: 0,
  };
}

/** The runner's missing-credential TAP skip: the CLI's token variable is emptied, no bundle marker. */
function noCredential(scenario: string, cli: string): OracleCase {
  const key = cli === "claude" ? "ANTHROPIC_API_KEY" : "COPILOT_GITHUB_TOKEN";
  return make(scenario, cli, "no-credential-skip", [], { [key]: "" });
}

function probeCells(scenario: string, cli: string): OracleCase[] {
  const n = CELLS[`${scenario}/${cli}`] as number;
  const transcript = cli === "claude" ? CLAUDE_JSON : COPILOT_TEXT;
  const cells = (entry: FixtureEntry): FixtureEntry[] => Array.from({ length: n }, () => entry);
  return [
    // No nonce can match: every cell resolves to its indeterminate outcome.
    make(scenario, cli, "baseline-unobservable", [version(cli), ...cells(cell(transcript))]),
    make(scenario, cli, "docker-fails", [version(cli), ...cells(cell("", 1, "boom\n"))]),
    noCredential(scenario, cli),
  ];
}

function byokSkip(scenario: string): OracleCase[] {
  return [
    // No tests/e2e/local.toml: byok_provider/byok_model are unset, scenario_skip -> exit 78.
    make(scenario, "copilot", "byok-undeclared-skip", []),
    noCredential(scenario, "copilot"),
  ];
}

export const cases: OracleCase[] = [
  ...byokSkip(S05),
  ...probeCells(S06, "copilot"),
  ...probeCells(S06, "claude"),
  ...byokSkip(S07),
  ...probeCells(S07, "claude"),
];

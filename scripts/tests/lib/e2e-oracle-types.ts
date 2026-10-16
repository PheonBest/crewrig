// e2e-oracle-types.ts — the shapes of the end-to-end harness oracle (spec 0261 R5, R7, R8): one
// `OracleCase` drives one (scenario, cli) pair of the runner against the Docker stand-in, and the
// observer returns one `Tuple` per case. The tuple is the unit that is recorded from the shell
// harness and replayed against the TypeScript port.

import type { FixtureEntry } from "./e2e-docker-standin.ts";

/** What a case's `seed` may write into: every path is inside the case's scratch tree. */
export interface SeedContext {
  readonly cli: string;
  /** The scratch `$HOME` of the runner. */
  readonly home: string;
  /** The e2e bundle root (`<CREWRIG_E2E_HOME>/.crewrig-e2e`); per-CLI bundles live in `<e2eHome>/<cli>/`. */
  readonly e2eHome: string;
  /** The report directory handed to the runner via `--report-dir`. */
  readonly reportDir: string;
}

export interface OracleCase {
  /** `<scenario>/<cli>/<variant>`; also the golden directory under the oracle fixtures. */
  readonly id: string;
  /** Scenario directory name, e.g. `01-layered-context`. */
  readonly scenario: string;
  readonly cli: string;
  /** `pass` for the nominal case, else the name of the negative (or alternative) path. */
  readonly variant: string;
  /** One entry per docker call the scenario makes, consumed by ordinal (see the stand-in). */
  readonly fixtures: readonly FixtureEntry[];
  /** Writes the bundle state the runner expects (rules dir, credential marker). */
  readonly seed?: (ctx: SeedContext) => void;
  /** Tool name -> text of a `#!/bin/sh` stub written (mode 0755) into the scratch bin dir. */
  readonly stubTools?: Readonly<Record<string, string>>;
  /** Extra environment for the runner (overrides the observer's defaults). */
  readonly env?: Readonly<Record<string, string>>;
  /** Value of E2E_JUDGE_MOCK_RESPONSE, e.g. `VERDICT=PASS CONF=0.95`. */
  readonly judgeMockResponse?: string;
  /** Exit status of the runner for this case. */
  readonly expectedExit: number;
}

/** The normalised observation of one case; key order is the serialisation order of the goldens. */
export interface Tuple {
  readonly id: string;
  readonly exit: number;
  /** `<report>/<cli>/<scenario>/scenario.tap`, or "" when the scenario wrote none. */
  readonly scenarioTap: string;
  /** Normalised argv of every docker call, in call order (from the stand-in log). */
  readonly dockerCommands: readonly (readonly string[])[];
  /** Text files under the report dir (relative path -> content), except effective.json and build-work/. */
  readonly files: Readonly<Record<string, string>>;
  readonly stdout: string;
  readonly stderr: string;
}

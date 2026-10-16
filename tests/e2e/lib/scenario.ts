// scenario.ts — the contract between the runner and a scenario, shared by the seven scenario entries
// (spec 0261 R1, R3). The runner exports E2E_LIB_DIR, E2E_REPORT_DIR, E2E_CLI, E2E_IMAGE,
// E2E_EFFECTIVE_JSON, E2E_CREWRIG_E2E_HOME, E2E_SCENARIO_DIR and E2E_RUN_ID (E2E_CREDENTIAL_PATH is
// optional); a scenario writes `<report dir>/scenario.tap`, prints one summary line, and exits 0 (all
// sub-tests ok), 1 (a sub-test failed) or 78 (skipped). `ScenarioTap` is `sub_emit` and
// `scenario_skip` of the shell; `runScenario` is the `set -euo pipefail` frame around a scenario.

import fs from "node:fs";
import path from "node:path";

export type Env = Readonly<Record<string, string | undefined>>;

export interface ScenarioCtx {
  readonly lib: string;
  readonly reportDir: string;
  readonly cli: string;
  readonly image: string;
  readonly effectiveJson: string;
  readonly e2eHome: string;
  readonly scenarioDir: string;
  readonly runId: string | undefined;
  readonly credentialPath: string | undefined;
  readonly env: Env;
}

/** Thrown to leave a scenario with a status (`scenario_skip` is 78); never a crash. */
export class ScenarioExit extends Error {
  readonly status: number;
  constructor(status: number, message = "") {
    super(message);
    this.status = status;
  }
}

const REQUIRED: ReadonlyArray<readonly [string, keyof ScenarioCtx]> = [
  ["E2E_LIB_DIR", "lib"],
  ["E2E_REPORT_DIR", "reportDir"],
  ["E2E_CLI", "cli"],
  ["E2E_IMAGE", "image"],
  ["E2E_EFFECTIVE_JSON", "effectiveJson"],
  ["E2E_CREWRIG_E2E_HOME", "e2eHome"],
  ["E2E_SCENARIO_DIR", "scenarioDir"],
];

/** The `: "${VAR:?runner must export VAR}"` block of every scenario. */
export function scenarioCtx(env: Env, script: string): ScenarioCtx {
  const found: Record<string, string> = {};
  for (const [name, key] of REQUIRED) {
    const value = env[name];
    if (value === undefined || value === "") {
      throw new ScenarioExit(1, `${script}: ${name}: runner must export ${name}\n`);
    }
    found[key] = value;
  }
  return {
    lib: found["lib"] as string,
    reportDir: found["reportDir"] as string,
    cli: found["cli"] as string,
    image: found["image"] as string,
    effectiveJson: found["effectiveJson"] as string,
    e2eHome: found["e2eHome"] as string,
    scenarioDir: found["scenarioDir"] as string,
    runId: env["E2E_RUN_ID"],
    credentialPath: env["E2E_CREDENTIAL_PATH"],
    env,
  };
}

/** `sub_emit`, `scenario_skip` and the final summary line of a scenario. */
export class ScenarioTap {
  private index = 0;
  private okCount = 0;
  private notOkCount = 0;
  private readonly tapFile: string;
  private readonly name: string;
  private readonly cli: string;
  /** What the scenario printed on standard output so far (the skip line and the summary). */
  stdout = "";

  constructor(ctx: ScenarioCtx, name: string) {
    this.tapFile = path.join(ctx.reportDir, "scenario.tap");
    this.name = name;
    this.cli = ctx.cli;
    fs.writeFileSync(this.tapFile, "");
  }

  emit(kind: "ok" | "not_ok", description: string): void {
    this.index += 1;
    if (kind === "ok") {
      fs.appendFileSync(this.tapFile, `ok ${this.index} - ${description}\n`);
      this.okCount += 1;
    } else {
      fs.appendFileSync(this.tapFile, `not ok ${this.index} - ${description}\n`);
      this.notOkCount += 1;
    }
  }

  /** `scenario_skip`: the plan line, the SKIP line, then exit 78. */
  skip(reason: string): never {
    fs.writeFileSync(this.tapFile, `1..0 # SKIP ${reason}\n`);
    this.stdout += `SKIP - ${this.cli}/${this.name}: ${reason}\n`;
    throw new ScenarioExit(78);
  }

  /** The plan line and the `N/M OK|FAIL` summary; returns the scenario's exit status. */
  finish(): number {
    fs.appendFileSync(this.tapFile, `1..${this.index}\n`);
    if (this.notOkCount > 0) {
      this.stdout += `${this.notOkCount}/${this.index} FAIL — ${this.cli}/${this.name}\n`;
      return 1;
    }
    this.stdout += `${this.okCount}/${this.index} OK — ${this.cli}/${this.name}\n`;
    return 0;
  }
}

/** Run a scenario body and turn its outcome into stdout, stderr and an exit status. */
export function runScenario(
  script: string,
  name: string,
  env: Env,
  body: (ctx: ScenarioCtx, tap: ScenarioTap) => number,
): { status: number; stdout: string; stderr: string } {
  let tap: ScenarioTap | undefined;
  try {
    const ctx = scenarioCtx(env, script);
    tap = new ScenarioTap(ctx, name);
    const status = body(ctx, tap);
    return { status, stdout: tap.stdout, stderr: "" };
  } catch (error) {
    if (error instanceof ScenarioExit) {
      return { status: error.status, stdout: tap?.stdout ?? "", stderr: error.message };
    }
    throw error;
  }
}

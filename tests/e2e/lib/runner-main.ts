// runner-main.ts — the e2e runner (twin of tests/e2e/run.sh, issue #78, ADR 0003): resolves the
// effective config, enumerates (scenario, cli) pairs, decides SKIP, runs the scenarios and emits a
// TAP 13 report. Everything it needs comes in as a parameter (spec 0261 R1).

import fs from "node:fs";
import path from "node:path";

import { e2eE2eHome, ExitError } from "../../../scripts/e2e/lib/auth-common.ts";
import { isEarlyExit, parseArgs } from "./runner-args.ts";
import { runCase, type RunnerIo } from "./runner-cases.ts";
import {
  obj,
  pruneReports,
  runId,
  scenarioKeys,
  strList,
  systemClock,
  Tap,
  writeEffective,
  type Json,
  type RunnerClock,
} from "./runner-config.ts";

export interface RunnerParams {
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  /** The `tests/e2e` directory. */
  readonly e2eDir: string;
  readonly io: RunnerIo;
  readonly clock?: RunnerClock;
}

const ALL_CLIS = ["claude", "gemini", "copilot"];

function dieLine(msg: string): ExitError {
  return new ExitError(1, `ERROR: ${msg}\n`);
}

function run(p: RunnerParams): number {
  const { io, e2eDir } = p;
  const parsed = parseArgs(p.argv);
  if (isEarlyExit(parsed)) {
    io.out(parsed.stdout);
    io.err(parsed.stderr);
    return parsed.status;
  }
  const env: Record<string, string> = { ...p.env, E2E_CREWRIG_E2E_HOME: e2eE2eHome(p.env) };
  const root = env["E2E_REPORTS_ROOT"] ?? path.join(e2eDir, "reports");
  const reportDir =
    parsed.reportDir === "" ? path.join(root, runId(p.clock ?? systemClock)) : parsed.reportDir;
  fs.mkdirSync(reportDir, { recursive: true });
  const tapOut = path.join(reportDir, "run.tap");
  fs.writeFileSync(tapOut, "");
  const line = (text: string): void => {
    io.out(`${text}\n`);
    fs.appendFileSync(tapOut, `${text}\n`);
  };
  pruneReports(root, parsed.keep, reportDir);

  const eff = writeEffective(e2eDir, reportDir, env);
  io.err(eff.stderr);
  if (eff.rc !== 0) return eff.rc;
  io.err(eff.info);
  const effectivePath = path.join(reportDir, "effective.json");
  const effective = obj(JSON.parse(fs.readFileSync(effectivePath, "utf8")) as unknown);

  const all = scenarioKeys(effective);
  if (parsed.scenario !== "" && !all.includes(parsed.scenario)) {
    throw dieLine(`scenario '${parsed.scenario}' not found in effective config.`);
  }
  const selected = parsed.scenario === "" ? all : [parsed.scenario];
  if (selected.length === 0) {
    io.err("[runner] no scenarios defined yet (waiting for #80) — emitting empty TAP plan.\n");
    line("TAP version 13");
    line("1..0 # no scenarios defined yet (waiting for #80)");
    return 0;
  }

  const tap = new Tap(line);
  line("TAP version 13");
  const ctx = {
    e2eDir,
    env,
    reportDir,
    effectivePath,
    effective: effective as Json,
    dryRun: parsed.dryRun,
    tap,
    io,
  };
  let runExit = 0;
  for (const scenario of selected) {
    const cfg = obj(obj(effective["scenarios"])[scenario]);
    const appliesTo = Array.isArray(cfg["applies_to"]) ? strList(cfg["applies_to"]) : ALL_CLIS;
    for (const cli of appliesTo) {
      if (parsed.cliFilter !== "" && cli !== parsed.cliFilter) continue;
      if (!(cli in obj(effective["cli"]))) {
        tap.emit("not_ok", `${cli}/${scenario}`);
        io.err(
          `[runner] scenario '${scenario}' applies_to '${cli}' but [cli.${cli}] is missing.\n`,
        );
        runExit = 1;
        continue;
      }
      if (runCase(ctx, scenario, cli) !== 0) runExit = 1;
    }
  }
  line(`1..${tap.index}`);
  line(`# pass: ${tap.ok}  fail: ${tap.nok}  skip: ${tap.skip}`);
  line(`# report dir: ${reportDir}`);
  return runExit;
}

/** Runs the runner and returns its exit status; an `ExitError` of a helper is the shell's `exit`. */
export function runRunner(p: RunnerParams): number {
  try {
    return run(p);
  } catch (e) {
    if (e instanceof ExitError) {
      p.io.err(e.stderr);
      return e.status;
    }
    throw e;
  }
}

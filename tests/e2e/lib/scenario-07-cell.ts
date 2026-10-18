// scenario-07-cell.ts — one probe C cell of scenarios/07-guidance-surface/run.sh (`run_cell` and
// `emit_cell_json`): stage the agent declaration, run the container, read the signals back. Twin
// of the shell scenario: change both, and keep them equal. Env and cwd are parameters.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { expandMount } from "./expand.ts";
import { findOnPath, runTool } from "./exec.ts";
import { bashQuoteC } from "./mask_command.ts";
import { probeSpawnSignals } from "./probe_spawn_markers.ts";
import { ScenarioExit, type ScenarioCtx } from "./scenario.ts";

/** What the cells share: the effective configuration of the CLI under test. */
export interface CellConfig {
  readonly ctx: ScenarioCtx;
  readonly cwd: string;
  readonly toolEnv: Record<string, string>;
  readonly probeArgv: readonly string[];
  readonly mounts: readonly string[];
  readonly envKeys: readonly string[];
  readonly promptTemplate: string;
}

/** The `CELL_*` globals the shell leaves behind after `run_cell`. */
export interface CellObservation {
  baselineObserved: boolean;
  spawnObserved: string;
  subagentResponded: string;
  nonceObserved: string;
  spawnModel: string;
  symptomMatched: boolean;
}

export interface CellEntry {
  readonly cell: string;
  readonly cli: string;
  readonly cli_version: string;
  readonly question: string;
  readonly outcome: string;
  readonly reason: string;
  readonly observables: {
    readonly spawn_observed: boolean;
    readonly subagent_responded: boolean;
    readonly nonce_observed: boolean;
    readonly spawn_model: string;
    readonly baseline_observed: boolean;
  };
  readonly observed_at: string;
}

const hex8 = (): string => crypto.randomBytes(8).toString("hex");
const SYMPTOM = /Model .* not found|Invalid model|Unknown model/i;

function readOrEmpty(file: string): string {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

/** `sed "s/__NONCE__/<nonce>/"`: the first occurrence on each line. */
function substituteNonce(text: string, nonce: string): string {
  return text
    .split("\n")
    .map((line) => line.replace("__NONCE__", () => nonce))
    .join("\n");
}

/** `chmod -R a+rX`: directories become world-searchable, files world-readable. */
function makeWorldReadable(dir: string): void {
  fs.chmodSync(dir, fs.statSync(dir).mode | 0o555);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) makeWorldReadable(full);
    else fs.chmodSync(full, fs.statSync(full).mode | 0o444);
  }
}

function stageFixture(cfg: CellConfig, templateFile: string, nonce: string): string {
  const tmp = cfg.toolEnv["TMPDIR"] || "/tmp";
  let dir: string;
  try {
    dir = fs.mkdtempSync(path.join(tmp, "crewrig-e2e-probe-c."));
  } catch {
    throw new ScenarioExit(
      1,
      `mktemp: failed to create directory via template '${tmp}/crewrig-e2e-probe-c.XXXXXX': No such file or directory\n`,
    );
  }
  fs.mkdirSync(path.join(dir, "agents"), { recursive: true });
  const template = fs.readFileSync(path.join(cfg.ctx.scenarioDir, templateFile), "utf8");
  fs.writeFileSync(path.join(dir, "agents", "probe-guidance.md"), substituteNonce(template, nonce));
  makeWorldReadable(dir);
  return dir;
}

export function runCell(cfg: CellConfig, cell: string, templateFile: string): CellObservation {
  const { ctx } = cfg;
  const nonce = `crewrig-probe-c-${hex8()}`;
  const baselineNonce = `crewrig-probe-c-base-${hex8()}`;
  const hostOut = path.join(ctx.reportDir, "out", cell);
  fs.mkdirSync(hostOut, { recursive: true });
  const prompt = cfg.promptTemplate.replaceAll("__BASELINE_NONCE__", baselineNonce);

  const fixtureDir = stageFixture(cfg, templateFile, nonce);
  const args = [
    "run",
    "--rm",
    "--name",
    `crewrig-e2e-07-${ctx.cli}-${cell}-${ctx.runId || "adhoc"}`,
    "-v",
    `${hostOut}:/out`,
    "-v",
    `${fixtureDir}:/home/agent/workspace/.claude:ro`,
  ];
  for (const m of cfg.mounts) {
    args.push("-v", expandMount(m, ctx.e2eHome, ctx.env["HOME"] ?? "").stdout.replace(/\n+$/, ""));
  }
  for (const k of cfg.envKeys) args.push("-e", k);
  args.push(ctx.image, ...cfg.probeArgv, prompt);

  const quoted = ["docker", ...args].map((a) => ` ${bashQuoteC(a)}`).join("");
  fs.writeFileSync(
    path.join(hostOut, "invocation.txt"),
    `cell: ${cell}\nimage: ${ctx.image}\nargv:${quoted}\n`,
  );

  const o = { cwd: cfg.cwd, env: cfg.toolEnv };
  const res =
    findOnPath("docker", cfg.toolEnv) === null
      ? { rc: 127, stdout: "", stderr: "docker: command not found\n" }
      : runTool("docker", args, o);
  fs.writeFileSync(path.join(hostOut, "stdout"), res.stdout);
  fs.writeFileSync(path.join(hostOut, "stderr"), res.stderr);
  fs.writeFileSync(path.join(hostOut, "exit"), `${res.rc}\n`);
  fs.rmSync(fixtureDir, { recursive: true, force: true });

  const stdoutFile = path.join(hostOut, "stdout");
  const baselineObserved =
    readOrEmpty(path.join(hostOut, "baseline.txt")).includes(baselineNonce) ||
    res.stdout.includes(baselineNonce);

  const signals = probeSpawnSignals(stdoutFile, "probe-guidance", nonce, cfg.cwd)
    .replace(/\n+$/, "")
    .split("|");
  const symptomMatched = SYMPTOM.test(res.stderr) || SYMPTOM.test(res.stdout);
  return {
    baselineObserved,
    spawnObserved: signals[0] ?? "",
    subagentResponded: signals[1] ?? "",
    nonceObserved: signals[2] ?? "",
    spawnModel: signals.slice(3).join("|"),
    symptomMatched,
  };
}

/** The `date -u +%Y-%m-%dT%H:%M:%SZ` of the shell. */
export const utcStamp = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

export function cellEntry(
  cell: string,
  cli: string,
  cliVersion: string,
  question: string,
  verdict: string,
  obs: CellObservation,
): CellEntry {
  const bar = verdict.indexOf("|");
  return {
    cell,
    cli,
    cli_version: cliVersion,
    question,
    outcome: bar < 0 ? verdict : verdict.slice(0, bar),
    reason: bar < 0 ? "" : verdict.slice(bar + 1),
    observables: {
      spawn_observed: obs.spawnObserved === "true",
      subagent_responded: obs.subagentResponded === "true",
      nonce_observed: obs.nonceObserved === "true",
      spawn_model: obs.spawnModel,
      baseline_observed: obs.baselineObserved,
    },
    observed_at: utcStamp(),
  };
}

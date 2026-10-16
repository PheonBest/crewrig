// scenario-06-cell.ts — one container run (a "cell") of scenarios/06-agent-surface-consumption: the
// fixture or ephemeral-home staging, the docker argv, invocation.txt, the spawn-marker and nonce
// checks and the probe B cell outcome. Twin of `run_cell` in run.sh (spec 0261); keep both equal.

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { stageCopilotEphemeralHome } from "./copilot_ephemeral_home.ts";
import { expandMount } from "./expand.ts";
import { runTool } from "./exec.ts";
import { bashQuoteC } from "./mask_command.ts";
import { probeSpawnSignals } from "./probe_spawn_markers.ts";
import { resolveProbeBCell } from "./probe_b_resolve.ts";
import { ScenarioExit, type ScenarioCtx } from "./scenario.ts";
import { utcStamp, type CellRecord } from "./scenario-06-verdict.ts";

export type MountMode = "workspace-nested" | "workspace-flat" | "ephemeral-home";

export interface CliConfig {
  readonly probeArgv: readonly string[];
  readonly mounts: readonly string[];
  readonly envKeys: readonly string[];
  readonly promptTemplate: string;
  readonly cliVersion: string;
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
}

export interface CellSpec {
  readonly cell: string;
  readonly layout: string;
  readonly pathDesc: string;
  readonly mode: MountMode;
  readonly role: string;
  readonly control: string;
}

const AGENT = "probe-consumer";
const COPILOT_HOME = "/home/agent/.copilot";

const hex8 = (): string => randomBytes(8).toString("hex");
const hasAny = (file: string, needle: string): boolean => {
  try {
    return fs.readFileSync(file).includes(needle);
  } catch {
    return false;
  }
};

/** `sed "s/__NONCE__/<nonce>/"`: the first occurrence on every line. */
function renderDeclaration(scenarioDir: string, nonce: string): string {
  const tmpl = fs.readFileSync(path.join(scenarioDir, "agent-consumer.md.tmpl"), "utf8");
  return tmpl
    .split("\n")
    .map((l) => l.replace("__NONCE__", () => nonce))
    .join("\n");
}

/** `chmod -R a+rX`. */
function worldReadable(p: string): void {
  const st = fs.statSync(p);
  if (st.isDirectory()) {
    fs.chmodSync(p, st.mode | 0o555);
    for (const e of fs.readdirSync(p)) worldReadable(path.join(p, e));
  } else {
    fs.chmodSync(p, st.mode | 0o444 | (st.mode & 0o111 ? 0o111 : 0));
  }
}

function tmpRoot(env: Readonly<Record<string, string>>): string {
  return env["TMPDIR"] === undefined || env["TMPDIR"] === "" ? "/tmp" : env["TMPDIR"];
}

/** The `evidence` field: `cat stdout stderr | tr '\n' ' ' | head -c 300`, as `$(...)` yields it. */
function evidence(hostOut: string): string {
  const parts = ["stdout", "stderr"].map((n) => fs.readFileSync(path.join(hostOut, n)));
  const joined = Buffer.concat(parts).toString("latin1").replaceAll("\n", " ");
  return Buffer.from(joined, "latin1").subarray(0, 300).toString("utf8").replaceAll("\u0000", "");
}

export interface CellResult {
  readonly record: CellRecord;
  readonly stderr: string;
}

export function runCell(
  ctx: ScenarioCtx,
  cfg: CliConfig,
  spec: CellSpec,
  scriptDir: string,
): CellResult {
  const nonce = `crewrig-probe-b-${hex8()}`;
  const baselineNonce = `crewrig-probe-b-baseline-${hex8()}`;
  const hostOut = path.join(ctx.reportDir, "out", spec.cell);
  fs.mkdirSync(hostOut, { recursive: true });
  fs.chmodSync(hostOut, 0o777);
  const prompt = cfg.promptTemplate.split("__BASELINE_NONCE__").join(baselineNonce);
  const name = `crewrig-e2e-06-${ctx.cli}-${spec.cell}-${ctx.runId || "adhoc"}`;
  const dockerArgs = ["run", "--rm", "--name", name, "-v", `${hostOut}:/out`];
  const home = ctx.env["HOME"] ?? "";
  const expand = (m: string): string => expandMount(m, ctx.e2eHome, home).stdout.replace(/\n$/, "");
  let stderr = "";
  let fixtureDir = "";
  let ephemeralHome = "";

  if (spec.mode === "workspace-nested" || spec.mode === "workspace-flat") {
    fixtureDir = fs.mkdtempSync(path.join(tmpRoot(cfg.env), "crewrig-e2e-probe-b."));
    const decl = renderDeclaration(ctx.scenarioDir, nonce);
    if (spec.mode === "workspace-nested") {
      fs.mkdirSync(path.join(fixtureDir, "agents", AGENT), { recursive: true });
      fs.writeFileSync(path.join(fixtureDir, "agents", AGENT, "AGENT.md"), decl);
    } else {
      fs.mkdirSync(path.join(fixtureDir, "agents"), { recursive: true });
      fs.writeFileSync(path.join(fixtureDir, "agents", `${AGENT}.md`), decl);
    }
    worldReadable(fixtureDir);
    dockerArgs.push("-v", `${fixtureDir}:/home/agent/workspace/.claude:ro`);
    for (const m of cfg.mounts) dockerArgs.push("-v", expand(m));
  } else {
    const declSrc = path.join(
      fs.mkdtempSync(path.join(tmpRoot(cfg.env), "crewrig-e2e-probe-b-decl-")),
      "decl",
    );
    fs.writeFileSync(declSrc, renderDeclaration(ctx.scenarioDir, nonce));
    const staged = stageCopilotEphemeralHome(
      [path.join(ctx.e2eHome, "copilot"), AGENT, declSrc],
      cfg.env,
      cfg.cwd,
      path.join(ctx.lib, "copilot_ephemeral_home.sh"),
    );
    fs.rmSync(path.dirname(declSrc), { recursive: true, force: true });
    stderr += staged.stderr;
    if (staged.rc !== 0) throw new ScenarioExit(staged.rc, stderr);
    ephemeralHome = staged.stdout.replace(/\n+$/, "");
    const override = `${ephemeralHome}:${COPILOT_HOME}:rw`;
    let substituted = false;
    for (const m of cfg.mounts) {
      if (m.includes(`:${COPILOT_HOME}:`) || m.endsWith(`:${COPILOT_HOME}`)) {
        dockerArgs.push("-v", override);
        substituted = true;
      } else dockerArgs.push("-v", expand(m));
    }
    if (!substituted) dockerArgs.push("-v", override);
  }
  for (const k of cfg.envKeys) dockerArgs.push("-e", k);
  dockerArgs.push(ctx.image, ...cfg.probeArgv, prompt);

  const quoted = ["docker", ...dockerArgs].map((a) => ` ${bashQuoteC(a)}`).join("");
  fs.writeFileSync(
    path.join(hostOut, "invocation.txt"),
    `cell: ${spec.cell} (${spec.layout})\nimage: ${ctx.image}\nargv:${quoted}\n`,
  );
  const res = runTool("docker", dockerArgs, { cwd: cfg.cwd, env: cfg.env });
  fs.writeFileSync(path.join(hostOut, "stdout"), res.stdout);
  fs.writeFileSync(path.join(hostOut, "stderr"), res.stderr);
  fs.writeFileSync(path.join(hostOut, "exit"), `${res.rc}\n`);
  if (fixtureDir !== "") fs.rmSync(fixtureDir, { recursive: true, force: true });
  if (ephemeralHome !== "") fs.rmSync(ephemeralHome, { recursive: true, force: true });

  const stdoutFile = path.join(hostOut, "stdout");
  const baseline =
    hasAny(path.join(hostOut, "baseline.txt"), baselineNonce) || hasAny(stdoutFile, baselineNonce);
  const legacy = hasAny(path.join(hostOut, "consumed.txt"), nonce) || hasAny(stdoutFile, nonce);
  const signals = probeSpawnSignals(stdoutFile, "Probe-consumer", nonce, cfg.cwd)
    .replace(/\n+$/, "")
    .split("|");
  const [spawn, responded, nonceSeen] = signals;
  const outcome = resolveProbeBCell(
    [nonceSeen ?? "", String(baseline)],
    "probe_b_resolve.sh",
  ).stdout.replace(/\n+$/, "");
  return {
    stderr,
    record: {
      cli: ctx.cli,
      cli_version: cfg.cliVersion,
      surface: spec.layout,
      layout: spec.layout,
      path: spec.pathDesc,
      outcome,
      observable: {
        nonce_observed: nonceSeen === "true",
        baseline_observed: baseline,
        spawn_observed: spawn === "true",
        subagent_responded: responded === "true",
        legacy_nonce_observed: legacy,
        evidence: evidence(hostOut),
      },
      control: spec.control,
      role: spec.role,
      observed_at: utcStamp(new Date()),
    },
  };
}

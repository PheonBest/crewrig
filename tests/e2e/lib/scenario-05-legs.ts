// scenario-05-legs.ts — the three probe legs and the fallback control of scenario 05 (probe A):
// declaration staging, the docker run, the spawn-marker signals. Twin of run_leg() and the row-1
// fallback block of tests/e2e/scenarios/05-copilot-model-routing/run.sh.

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { copilotHomeMountOverride, stageCopilotEphemeralHome } from "./copilot_ephemeral_home.ts";
import { expandMount } from "./expand.ts";
import { findOnPath, runTool } from "./exec.ts";
import { bashQuoteC } from "./mask_command.ts";
import { probeSpawnSignals } from "./probe_spawn_markers.ts";
import type { ScenarioCtx } from "./scenario.ts";

export interface LegConfig {
  readonly ctx: ScenarioCtx;
  readonly cwd: string;
  readonly env: Record<string, string>;
  readonly mounts: readonly string[];
  readonly envKeys: readonly string[];
  readonly probeArgv: readonly string[];
  readonly prompt: string;
}

export interface LegResult {
  readonly nonceObserved: string;
  readonly spawnObserved: string;
  readonly subagentResponded: string;
  readonly legtxtObserved: string;
  readonly symptom: string;
  readonly evidence: string;
}

const SYMPTOM_RE = /Agent completed but produced no response\.|not found on provider|HTTP 404/;
const COPILOT_HOME = "/home/agent/.copilot";

const tmpDir = (env: Record<string, string>): string => env["TMPDIR"] || "/tmp";

/** `od -An -N8 -tx1 /dev/urandom | tr -d ' \n'` behind the `crewrig-probe-` prefix. */
export function newNonce(): string {
  return `crewrig-probe-${randomBytes(8).toString("hex")}`;
}

/** `head -c 300` is a byte count; a split multibyte tail decodes to U+FFFD as jq would read it. */
function headBytes(text: string, n: number): string {
  return Buffer.from(text, "utf8").subarray(0, n).toString("utf8");
}

/** `sed "s/__NONCE__/<nonce>/"`: the first occurrence on every line. */
function substituteNonce(template: string, nonce: string): string {
  return template
    .split("\n")
    .map((l) => l.replace("__NONCE__", () => nonce))
    .join("\n");
}

function dockerRun(cfg: LegConfig, argv: readonly string[], stdoutFile: string, errFile: string) {
  const res =
    findOnPath("docker", cfg.env) === null
      ? { rc: 127, stdout: "", stderr: "docker: command not found\n" }
      : runTool("docker", argv, { cwd: cfg.cwd, env: cfg.env });
  fs.writeFileSync(stdoutFile, res.stdout);
  fs.writeFileSync(errFile, res.stderr);
  fs.writeFileSync(path.join(path.dirname(stdoutFile), "exit"), `${res.rc}\n`);
}

/** `[[ -s leg.txt ]] || cp stdout leg.txt`, then the corroboration-only grep of the nonce. */
function legTxtObserved(hostOut: string, nonce: string): string {
  const answer = path.join(hostOut, "leg.txt");
  let size = 0;
  try {
    size = fs.statSync(answer).size;
  } catch {
    size = 0;
  }
  if (size === 0) {
    try {
      fs.copyFileSync(path.join(hostOut, "stdout"), answer);
    } catch {
      // cp ... || true
    }
  }
  try {
    return String(fs.readFileSync(answer, "latin1").includes(nonce));
  } catch {
    return "false";
  }
}

function signals(cfg: LegConfig, hostOut: string, nonce: string) {
  const line = probeSpawnSignals(
    path.join(hostOut, "stdout"),
    "Probe-router",
    nonce,
    cfg.cwd,
  ).replace(/\n+$/, "");
  const p = line.split("|");
  return {
    spawn: p[0] ?? "",
    responded: p[1] ?? "",
    nonceIn: p[2] ?? "",
    model: p.slice(3).join("|"),
  };
}

function readOr(file: string): string {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function mountArgs(cfg: LegConfig, override?: string): string[] {
  const out: string[] = [];
  for (const m of cfg.mounts) {
    if (
      override !== undefined &&
      (m.includes(`:${COPILOT_HOME}:`) || m.endsWith(`:${COPILOT_HOME}`))
    ) {
      out.push("-v", override);
    } else {
      out.push(
        "-v",
        expandMount(m, cfg.ctx.e2eHome, cfg.env["HOME"] ?? "").stdout.replace(/\n+$/, ""),
      );
    }
  }
  return out;
}

/** `run_leg <leg> <template>`. */
export function runLeg(cfg: LegConfig, leg: string, template: string): LegResult {
  const { ctx } = cfg;
  const nonce = newNonce();
  const fixtureDir = fs.mkdtempSync(path.join(tmpDir(cfg.env), "crewrig-e2e-probe-a."));
  const agentDir = path.join(fixtureDir, "agents", "probe-router");
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentDir, "AGENT.md"),
    substituteNonce(fs.readFileSync(path.join(ctx.scenarioDir, template), "utf8"), nonce),
  );
  // chmod -R a+rX: the declaration is throwaway template text.
  fs.chmodSync(fixtureDir, 0o755);
  fs.chmodSync(path.join(fixtureDir, "agents"), 0o755);
  fs.chmodSync(agentDir, 0o755);
  fs.chmodSync(path.join(agentDir, "AGENT.md"), 0o644);

  const hostOut = path.join(ctx.reportDir, "out", leg);
  fs.mkdirSync(hostOut, { recursive: true });
  const name = `crewrig-e2e-05-${leg}-${ctx.runId || "adhoc"}`;
  const argv = [
    "run",
    "--rm",
    "--name",
    name,
    "-v",
    `${hostOut}:/out`,
    "-v",
    `${fixtureDir}:/home/agent/workspace/.claude:ro`,
    ...mountArgs(cfg),
  ];
  for (const k of cfg.envKeys) argv.push("-e", k);
  argv.push(ctx.image, ...cfg.probeArgv, cfg.prompt);

  const quoted = ["docker", ...argv].map((a) => ` ${bashQuoteC(a)}`).join("");
  fs.writeFileSync(
    path.join(hostOut, "invocation.txt"),
    `leg: ${leg}\nimage: ${ctx.image}\nargv:${quoted}\n`,
  );
  dockerRun(cfg, argv, path.join(hostOut, "stdout"), path.join(hostOut, "stderr"));

  const legtxt = legTxtObserved(hostOut, nonce);
  const sig = signals(cfg, hostOut, nonce);
  const combined = (
    readOr(path.join(hostOut, "stdout")) + readOr(path.join(hostOut, "stderr"))
  ).replace(/\n+$/, "");
  fs.rmSync(fixtureDir, { recursive: true, force: true });
  return {
    nonceObserved: sig.nonceIn,
    spawnObserved: sig.spawn,
    subagentResponded: sig.responded,
    legtxtObserved: legtxt,
    symptom: String(SYMPTOM_RE.test(combined)),
    evidence: headBytes(combined.replaceAll("\n", " "), 300),
  };
}

/** The row-1 fallback: the control declaration at `~/.copilot/agents/<n>.md` in an ephemeral home. */
export function runFallback(cfg: LegConfig, cleanup: string[]): LegResult {
  const { ctx } = cfg;
  const nonce = newNonce();
  const declDir = fs.mkdtempSync(path.join(tmpDir(cfg.env), "crewrig-e2e-probe-a-fallback."));
  const decl = path.join(declDir, "decl.md");
  fs.writeFileSync(
    decl,
    substituteNonce(
      fs.readFileSync(path.join(ctx.scenarioDir, "agent-control.md.tmpl"), "utf8"),
      nonce,
    ),
  );
  const staged = stageCopilotEphemeralHome(
    [path.join(ctx.e2eHome, "copilot"), "probe-router", decl],
    cfg.env,
    cfg.cwd,
    path.join(ctx.lib, "copilot_ephemeral_home.sh"),
  );
  fs.rmSync(declDir, { recursive: true, force: true });
  const home = staged.stdout.replace(/\n+$/, "");
  cleanup.push(home);

  const hostOut = path.join(ctx.reportDir, "out", "fallback_control");
  fs.mkdirSync(hostOut, { recursive: true });
  const override = copilotHomeMountOverride(
    [home],
    path.join(ctx.lib, "copilot_ephemeral_home.sh"),
  ).stdout.replace(/\n+$/, "");
  const argv = [
    "run",
    "--rm",
    "--name",
    `crewrig-e2e-05-fallback-${ctx.runId || "adhoc"}`,
    "-v",
    `${hostOut}:/out`,
    ...mountArgs(cfg, override),
  ];
  if (!cfg.mounts.some((m) => m.includes(COPILOT_HOME))) argv.push("-v", override);
  for (const k of cfg.envKeys) argv.push("-e", k);
  argv.push(ctx.image, ...cfg.probeArgv, cfg.prompt);
  dockerRun(cfg, argv, path.join(hostOut, "stdout"), path.join(hostOut, "stderr"));

  const legtxt = legTxtObserved(hostOut, nonce);
  const sig = signals(cfg, hostOut, nonce);
  const raw = readOr(path.join(hostOut, "stdout")) + readOr(path.join(hostOut, "stderr"));
  return {
    nonceObserved: sig.nonceIn,
    spawnObserved: sig.spawn,
    subagentResponded: sig.responded,
    legtxtObserved: legtxt,
    symptom: "",
    evidence: headBytes(raw.replaceAll("\n", " "), 300),
  };
}

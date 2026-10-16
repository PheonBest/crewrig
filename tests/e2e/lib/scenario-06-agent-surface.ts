// scenario-06-agent-surface.ts — TypeScript twin of scenarios/06-agent-surface-consumption/run.sh
// (spec 0194 probe B, spec 0261): per CLI and per per-file layout, does the agent reader consume a
// repository agent declaration under `.claude/agents/`. Twin of the shell scenario: change both, and
// keep them equal. Env and cwd are parameters; nothing here reads process state.

import fs from "node:fs";
import path from "node:path";

import { runTool } from "./exec.ts";
import { ScenarioExit, ScenarioTap, scenarioCtx, type Env } from "./scenario.ts";
import { runCell, type CellSpec, type CliConfig } from "./scenario-06-cell.ts";
import { writeSubplan, writeVerdict, type CellRecord } from "./scenario-06-verdict.ts";

export interface ScenarioOutcome {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

const NAME = "06-agent-surface-consumption";
const NESTED = ".claude/agents/probe-consumer/AGENT.md";
const FLAT = ".claude/agents/probe-consumer.md";

function stringEnv(env: Env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined) out[k] = v;
  return out;
}

function listFrom(effective: unknown, cli: string, key: string): string[] {
  const cliCfg = (effective as { cli?: Record<string, Record<string, unknown>> }).cli?.[cli];
  const value = cliCfg?.[key];
  return Array.isArray(value) ? value.map((v) => String(v)) : [];
}

/** `$(docker run --rm IMG CLI --version 2>/dev/null | head -n1 || echo unknown)` under pipefail. */
function cliVersion(image: string, cli: string, env: Record<string, string>, cwd: string): string {
  const res = runTool("docker", ["run", "--rm", image, cli, "--version"], { cwd, env });
  const nl = res.stdout.indexOf("\n");
  const first = nl < 0 ? res.stdout : res.stdout.slice(0, nl + 1);
  const text = res.rc === 0 ? first : `${first}unknown\n`;
  return text.replace(/\n+$/, "").replaceAll("\u0000", "");
}

export function runScenario06(env: Env, cwd: string): ScenarioOutcome {
  let stderr = "";
  let skipTap: ScenarioTap | undefined;
  try {
    const ctx = scenarioCtx(env, "run.sh");
    if (ctx.cli !== "copilot" && ctx.cli !== "claude") {
      skipTap = new ScenarioTap(ctx, NAME);
      skipTap.skip("probe B covers copilot and claude only (R12: at least)");
    }
    const sEnv = stringEnv(env);
    const effective: unknown = JSON.parse(fs.readFileSync(ctx.effectiveJson, "utf8"));
    const probeArgv = [
      ...listFrom(effective, ctx.cli, "command"),
      ...listFrom(effective, ctx.cli, "command_args"),
      "-p",
    ];
    if (ctx.cli === "claude")
      probeArgv.push("--dangerously-skip-permissions", "--output-format", "json");
    const cfg: CliConfig = {
      probeArgv,
      mounts: listFrom(effective, ctx.cli, "mounts"),
      envKeys: listFrom(effective, ctx.cli, "env_keys"),
      promptTemplate: fs
        .readFileSync(path.join(ctx.scenarioDir, "probe.prompt"), "utf8")
        .replace(/\n+$/, ""),
      cliVersion: cliVersion(ctx.image, ctx.cli, sEnv, cwd),
      env: sEnv,
      cwd,
    };
    fs.mkdirSync(path.join(ctx.reportDir, "out"), { recursive: true });

    const cells: CellRecord[] = [];
    const run = (spec: CellSpec): CellRecord => {
      const res = runCell(ctx, cfg, spec, ctx.scenarioDir);
      stderr += res.stderr;
      cells.push(res.record);
      return res.record;
    };
    const recorded = (cell: string, layout: string, pathDesc: string, mode: CellSpec["mode"]) => ({
      cell,
      layout,
      pathDesc,
      mode,
      role: "recorded",
      control:
        ctx.cli === "copilot" ? "in-cell-liveness-baseline" : "in-cell-liveness-baseline-only",
    });
    const nestedSpec = recorded("nested", ".claude/agents/ (nested)", NESTED, "workspace-nested");
    const flatSpec = recorded("flat", ".claude/agents/ (flat)", FLAT, "workspace-flat");
    const nestedOutcome = run(nestedSpec).outcome;
    run(flatSpec);
    let copilotNested = "";
    if (ctx.cli === "copilot") {
      copilotNested = nestedOutcome;
      run({
        cell: "cross_cell_control",
        layout: "~/.copilot/agents/ (flat)",
        pathDesc: "~/.copilot/agents/probe-consumer.md",
        mode: "ephemeral-home",
        role: "cross-cell-control",
        control: "cross-cell-documented-layout",
      });
    }

    writeVerdict(ctx.reportDir, ctx.runId || "adhoc", new Date(), cells, copilotNested);
    writeSubplan(ctx.reportDir, cells);
    const stdout = `probe B recorded ${cells.length} cell(s) — ${ctx.cli} (report: ${path.join(ctx.reportDir, "verdict.json")})\n`;
    return { status: 0, stdout, stderr };
  } catch (error) {
    if (error instanceof ScenarioExit) {
      return {
        status: error.status,
        stdout: skipTap?.stdout ?? "",
        stderr: stderr + error.message,
      };
    }
    throw error;
  }
}

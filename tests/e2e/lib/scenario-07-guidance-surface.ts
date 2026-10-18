// scenario-07-guidance-surface.ts — TypeScript twin of scenarios/07-guidance-surface/run.sh (probe C,
// spec 0203): guidance-surface prose vs the Copilot reader, `effort:` frontmatter inertness and
// orchestrator guidance reliability. Twin of the shell scenario: change both, and keep them equal.

import fs from "node:fs";
import path from "node:path";

import { findOnPath, runTool } from "./exec.ts";
import {
  resolveProbeC1,
  resolveProbeC2,
  resolveProbeC3,
  resolveProbeC4,
} from "./probe_c_resolve.ts";
import {
  cellEntry,
  runCell,
  utcStamp,
  type CellConfig,
  type CellEntry,
  type CellObservation,
} from "./scenario-07-cell.ts";
import {
  runScenario,
  ScenarioExit,
  type Env,
  type ScenarioCtx,
  type ScenarioTap,
} from "./scenario.ts";
import { tomlMerge } from "./toml_merge.ts";

const NAME = "07-guidance-surface";

type Json = Record<string, unknown> | undefined;

function stringEnv(env: Env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined) out[k] = v;
  return out;
}

/** `jq -r '.x // ""'`. */
function jqText(value: unknown): string {
  if (value === undefined || value === null || value === false) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** `mapfile -t < <(jq -r '.[]')`: one element per output line. */
function listFrom(cliCfg: Json, key: string): string[] {
  const value = cliCfg?.[key];
  if (!Array.isArray(value)) return [];
  return value.flatMap((v) => (typeof v === "string" ? v : JSON.stringify(v)).split("\n"));
}

function requireByok(
  ctx: ScenarioCtx,
  tap: ScenarioTap,
  cliCfg: Json,
  cwd: string,
  toolEnv: Record<string, string>,
): void {
  const provider = jqText(cliCfg?.["byok_provider"]);
  const model = jqText(cliCfg?.["byok_model"]);
  if (provider === "" || model === "") {
    tap.skip(
      "byok_provider/byok_model not declared — copy tests/e2e/local.toml.example's [cli.copilot] block to tests/e2e/local.toml, then run `task e2e:auth:ollama`",
    );
  }
  const defaultsToml = path.join(path.resolve(ctx.scenarioDir, "..", ".."), "defaults.toml");
  const merged = tomlMerge([defaultsToml], cwd, toolEnv);
  if (merged.rc !== 0) throw new ScenarioExit(merged.rc, merged.stderr);
  const defaultsCfg = (JSON.parse(merged.stdout) as { cli?: { copilot?: Record<string, unknown> } })
    .cli?.copilot;
  const command = (c: Json) => JSON.stringify(c?.["command"] ?? null);
  if (command(cliCfg) === command(defaultsCfg)) {
    tap.skip(
      `byok_provider='${provider}' declared but [cli.copilot].command is unchanged from defaults — wrapper not in force`,
    );
  }
}

/** `docker run --rm <image> <cli> --version 2>/dev/null | head -n1 || echo unknown` under pipefail. */
function cliVersion(ctx: ScenarioCtx, cwd: string, toolEnv: Record<string, string>): string {
  if (ctx.cli === "antigravity") return "unknown";
  const res =
    findOnPath("docker", toolEnv) === null
      ? { rc: 127, stdout: "" }
      : runTool("docker", ["run", "--rm", ctx.image, ctx.cli, "--version"], { cwd, env: toolEnv });
  const nl = res.stdout.indexOf("\n");
  const firstLine = nl < 0 ? res.stdout : res.stdout.slice(0, nl + 1);
  const text = res.rc === 0 ? firstLine : `${firstLine}unknown\n`;
  return text.replace(/\n+$/, "");
}

function body(env: Env, cwd: string, ctx: ScenarioCtx, tap: ScenarioTap): number {
  const toolEnv = stringEnv(env);
  const libPath = path.join(ctx.lib, "probe_c_resolve.sh");
  if (ctx.cli !== "copilot" && ctx.cli !== "claude" && ctx.cli !== "antigravity") {
    tap.skip("probe C applies to copilot, claude, and antigravity");
  }
  const effective = JSON.parse(fs.readFileSync(ctx.effectiveJson, "utf8")) as Json;
  const clis = (effective as { cli?: Record<string, Record<string, unknown>> }).cli;
  const cliCfg = clis?.[ctx.cli];
  if (ctx.cli === "copilot") requireByok(ctx, tap, cliCfg, cwd, toolEnv);

  const probeArgv = [...listFrom(cliCfg, "command"), ...listFrom(cliCfg, "command_args"), "-p"];
  const promptTemplate = fs
    .readFileSync(path.join(ctx.scenarioDir, "probe.prompt"), "utf8")
    .replace(/\n+$/, "");
  const version = cliVersion(ctx, cwd, toolEnv);
  fs.mkdirSync(path.join(ctx.reportDir, "out"), { recursive: true });
  const cfg: CellConfig = {
    ctx,
    cwd,
    toolEnv,
    probeArgv,
    mounts: listFrom(cliCfg, "mounts"),
    envKeys: listFrom(cliCfg, "env_keys"),
    promptTemplate,
  };

  const cells: CellEntry[] = [];
  const verdict = (out: { stdout: string }): string => out.stdout.replace(/\n+$/, "");
  const flags = (o: CellObservation): string[] => [
    String(o.baselineObserved),
    o.nonceObserved,
    o.subagentResponded,
    String(o.symptomMatched),
  ];
  const guidance = (o: CellObservation, requested: string, control: string): string[] => [
    String(o.baselineObserved),
    o.nonceObserved,
    o.subagentResponded,
    o.spawnModel,
    requested,
    control,
  ];
  const add = (cell: string, q: string, v: string, o: CellObservation) =>
    cells.push(cellEntry(cell, ctx.cli, version, q, v, o));

  if (ctx.cli === "copilot") {
    const c1 = runCell(cfg, "C1", "agent-c1.md.tmpl");
    add(
      "C1",
      "Does description prose naming an unserved model disturb Copilot BYOK routing?",
      verdict(resolveProbeC1(flags(c1), libPath)),
      c1,
    );
    const c2 = runCell(cfg, "C2", "agent-c2.md.tmpl");
    add(
      "C2",
      "Is non-model effort: frontmatter key inert for Copilot reader?",
      verdict(resolveProbeC2(flags(c2), libPath)),
      c2,
    );
  } else if (ctx.cli === "claude") {
    const control = runCell(cfg, "C3-control", "agent-c3-control.md.tmpl");
    const c3 = runCell(cfg, "C3", "agent-c3-guided.md.tmpl");
    add(
      "C3",
      "Does Claude Code orchestrator honor description-borne model and effort requests?",
      verdict(resolveProbeC3(guidance(c3, "haiku", control.spawnModel), libPath)),
      c3,
    );
  } else {
    const control = runCell(cfg, "C4-control", "agent-c3-control.md.tmpl");
    const c4 = runCell(cfg, "C4", "agent-c4.md.tmpl");
    add(
      "C4",
      "Does Antigravity CLI orchestrator honor description-borne model requests?",
      verdict(resolveProbeC4(guidance(c4, "gemini-3.8-flash-low", control.spawnModel), libPath)),
      c4,
    );
  }

  const doc = {
    probe: NAME,
    spec: "0203",
    run_id: ctx.runId || "adhoc",
    observed_at: utcStamp(),
    cells,
  };
  // jq escapes DEL as \u007f where JSON.stringify leaves it raw.
  const json = JSON.stringify(doc, null, 2).replaceAll("\u007f", "\\u007f");
  const verdictFile = path.join(ctx.reportDir, "verdict.json");
  fs.writeFileSync(verdictFile, `${json}\n`);

  const lines = cells.map(
    (c, i) => `ok ${i + 1} - ${c.cell} (${c.cli}): ${c.outcome} [${c.reason}]\n`,
  );
  fs.writeFileSync(
    path.join(ctx.reportDir, "scenario.tap"),
    `${lines.join("")}1..${cells.length}\n`,
  );
  tap.stdout += `probe C recorded ${cells.length} cell(s) — ${ctx.cli} (report: ${verdictFile})\n`;
  return 0;
}

export function runScenario07(
  env: Env,
  cwd: string,
): { status: number; stdout: string; stderr: string } {
  return runScenario("run.sh", NAME, env, (ctx, tap) => body(env, cwd, ctx, tap));
}

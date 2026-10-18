// scenario-05-copilot-model-routing.ts — scenario 05 (probe A, spec 0194 R8-R11), Copilot only: does
// a `model:` hint in a repository agent declaration break subagent routing on a BYOK session? Twin
// of tests/e2e/scenarios/05-copilot-model-routing/run.sh: change both, and keep them equal.
// Env and cwd are parameters; nothing here reads process state.

import fs from "node:fs";
import path from "node:path";

import { findOnPath, runTool } from "./exec.ts";
import { maskCommandJson } from "./mask_command.ts";
import { resolveProbeA } from "./probe_a_resolve.ts";
import { runFallback, runLeg, type LegConfig, type LegResult } from "./scenario-05-legs.ts";
import { ScenarioExit, ScenarioTap, scenarioCtx, type Env } from "./scenario.ts";
import { tomlMerge } from "./toml_merge.ts";

export interface ScenarioOutcome {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

const NAME = "05-copilot-model-routing";

function stringEnv(env: Env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined) out[k] = v;
  return out;
}

/** `jq -r '<path> // ""'`: null and false are absent, a non-string prints as JSON. */
function jqText(value: unknown): string {
  if (value === null || value === undefined || value === false) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function listOf(cfg: Record<string, unknown>, key: string): string[] {
  const v = cfg[key];
  return Array.isArray(v) ? v.map((x) => String(x)) : [];
}

/** `$(cat file)`. */
function catText(file: string): string {
  return fs.readFileSync(file, "utf8").replace(/\n+$/, "");
}

/** `docker run --rm <image> copilot --version 2>/dev/null | head -n1 || echo unknown`. */
function copilotVersion(env: Record<string, string>, cwd: string, image: string): string {
  const res =
    findOnPath("docker", env) === null
      ? { rc: 127, stdout: "" }
      : runTool("docker", ["run", "--rm", image, "copilot", "--version"], { cwd, env });
  const first = res.stdout.includes("\n")
    ? res.stdout.slice(0, res.stdout.indexOf("\n") + 1)
    : res.stdout;
  const text = res.rc === 0 ? first : `${first}unknown\n`;
  return text.replace(/\n+$/, "");
}

function legObject(modelValue: string | null, r: LegResult): Record<string, unknown> {
  return {
    ...(modelValue === null ? { model_value: null } : { model_value: modelValue }),
    nonce_observed: r.nonceObserved === "true",
    evidence: r.evidence,
    spawn_observed: r.spawnObserved === "true",
    subagent_responded: r.subagentResponded === "true",
    legtxt_nonce_observed: r.legtxtObserved === "true",
  };
}

const ESCALATION =
  "Probe A (spec 0194) row-1 escalation from #1103: the control leg" +
  " observed no nonce at `.claude/agents/<n>/AGENT.md`, but DID observe" +
  " one at the fallback `~/.copilot/agents/<n>.md` layout. This puts" +
  " requirement 8's shared-read hazard premise in question rather" +
  " than confirming it. See the probe A verdict comment on #1103 for" +
  " the full record.\n";

export function runScenario05(
  env: Env,
  cwd: string,
  now: () => Date = () => new Date(),
): ScenarioOutcome {
  let tap: ScenarioTap | undefined;
  const cleanup: string[] = [];
  try {
    const ctx = scenarioCtx(env, "run.sh");
    tap = new ScenarioTap(ctx, NAME);
    const sEnv = stringEnv(env);
    if (ctx.cli !== "copilot") tap.skip("probe A applies only to copilot");

    const effective = JSON.parse(fs.readFileSync(ctx.effectiveJson, "utf8")) as {
      cli?: { copilot?: Record<string, unknown> };
    };
    const cop = effective.cli?.copilot ?? {};
    const provider = jqText(cop["byok_provider"]);
    const model = jqText(cop["byok_model"]);
    if (provider === "" || model === "") {
      tap.skip(
        "byok_provider/byok_model not declared — copy tests/e2e/local.toml.example's [cli.copilot] block to tests/e2e/local.toml, then run `task e2e:auth:ollama`",
      );
    }

    const defaultsToml = path.join(path.resolve(ctx.scenarioDir, "..", ".."), "defaults.toml");
    const merged = tomlMerge([defaultsToml], cwd, sEnv);
    if (merged.rc !== 0) throw new ScenarioExit(merged.rc, merged.stderr);
    const defaultsCmd = JSON.stringify(
      (JSON.parse(merged.stdout) as { cli?: { copilot?: { command?: unknown } } }).cli?.copilot
        ?.command ?? null,
    );
    if (JSON.stringify(cop["command"] ?? null) === defaultsCmd) {
      tap.skip(
        `byok_provider='${provider}' declared but [cli.copilot].command is unchanged from the defaults-only merge — the wrapper is not in force (edit tests/e2e/local.toml)`,
      );
    }

    const cfg: LegConfig = {
      ctx,
      cwd,
      env: sEnv,
      mounts: listOf(cop, "mounts"),
      envKeys: listOf(cop, "env_keys"),
      probeArgv: [...listOf(cop, "command"), ...listOf(cop, "command_args"), "-p"],
      prompt: catText(path.join(ctx.scenarioDir, "probe.prompt")),
    };
    const version = copilotVersion(sEnv, cwd, ctx.image) || "";
    fs.mkdirSync(path.join(ctx.reportDir, "out"), { recursive: true });

    const control = runLeg(cfg, "control_no_hint", "agent-control.md.tmpl");
    const efficacy = runLeg(cfg, "hint_efficacy", "agent-hint-efficacy.md.tmpl");
    const bearing = runLeg(cfg, "model_bearing", "agent-model-bearing.md.tmpl");
    const fallback = control.nonceObserved !== "true" ? runFallback(cfg, cleanup) : undefined;
    if (fallback?.nonceObserved === "true") {
      fs.writeFileSync(path.join(ctx.reportDir, "escalation-1101.md"), ESCALATION);
    }

    const resolved = resolveProbeA(
      [
        control.nonceObserved,
        efficacy.nonceObserved,
        efficacy.symptom,
        bearing.nonceObserved,
        bearing.symptom,
      ],
      path.join(ctx.lib, "probe_a_resolve.sh"),
    ).stdout.replace(/\n+$/, "");
    const bar = resolved.indexOf("|");
    const verdict = bar < 0 ? resolved : resolved.slice(0, bar);
    const reason = bar < 0 ? resolved : resolved.slice(bar + 1);

    const masked = JSON.parse(
      maskCommandJson(JSON.stringify(cop["command"] ?? null)).stdout,
    ) as unknown;
    const doc = {
      probe: NAME,
      spec: "0194",
      run_id: ctx.runId || "adhoc",
      observed_at: `${now().toISOString().slice(0, 19)}Z`,
      verdict,
      reason: reason === "" ? null : reason,
      cli: ctx.cli,
      cli_version: version,
      declared_provider: provider,
      declared_model: model,
      effective_command: masked,
      credential_path: ctx.credentialPath || "unknown",
      surface: ".claude/agents/",
      layout: "nested (.claude/agents/<n>/AGENT.md)",
      legs: {
        control_no_hint: legObject(null, control),
        hint_efficacy: legObject("crewrig-probe-no-such-model", efficacy),
        model_bearing: legObject("sonnet", bearing),
      },
      fallback_control:
        fallback === undefined
          ? null
          : { layout: "~/.copilot/agents/<n>.md", ...legObject(null, fallback) },
      upstream_issue: "github/copilot-cli#4437",
    };
    if (doc.fallback_control !== null)
      delete (doc.fallback_control as Record<string, unknown>)["model_value"];
    fs.writeFileSync(
      path.join(ctx.reportDir, "verdict.json"),
      `${JSON.stringify(doc, null, 2).replaceAll("\u007f", "\\u007f")}\n`,
    );

    const tapFile = path.join(ctx.reportDir, "scenario.tap");
    const suffix = reason === "" ? "" : ` (${reason})`;
    fs.writeFileSync(tapFile, `ok 1 - probe A recorded verdict: ${verdict}${suffix}\n1..1\n`);
    tap.stdout += `VERDICT ${verdict}${reason === "" ? "" : ` [${reason}]`} — ${ctx.cli}/${NAME} (report: ${path.join(ctx.reportDir, "verdict.json")})\n`;
    return { status: 0, stdout: tap.stdout, stderr: "" };
  } catch (error) {
    if (error instanceof ScenarioExit) {
      return { status: error.status, stdout: tap?.stdout ?? "", stderr: error.message };
    }
    throw error;
  } finally {
    for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });
  }
}

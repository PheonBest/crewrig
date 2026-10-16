// scenario-02-sidecar.ts — the MemPalace sidecar frame shared by scenarios 02 (cross-tool memory)
// and 04 (harness loop): the docker calls with their output redirections, the volume and sidecar
// start with the two soft skips (exit 78), the `trap cleanup EXIT` (always `docker rm -f` of the
// sidecar, then `docker volume rm -f` of the volume), the sub-test counter and the final summary
// line `OK — <cli>/<name> (<n> assertions)` / `<nok>/<n> FAIL — <cli>/<name>`. Twin of the
// corresponding parts of the two run.sh files. Nothing reads process.env or process.cwd().

import fs from "node:fs";

import type { AssertResult } from "./assert.ts";
import { runTool } from "./exec.ts";
import { ScenarioExit, ScenarioTap, scenarioCtx, type Env, type ScenarioCtx } from "./scenario.ts";

export const MEMPALACE_IMAGE = "crewrig/e2e-mempalace:latest";

export interface DockerOutput {
  /** `>file`: the file is created (truncated) even when the call fails; absent means `>/dev/null`. */
  readonly stdoutFile?: string;
  /** `2>file`; absent means `2>/dev/null`. */
  readonly stderrFile?: string;
  readonly input?: string;
}

export interface SidecarScenario {
  readonly ctx: ScenarioCtx;
  readonly tap: ScenarioTap;
  readonly volume: string;
  readonly sidecar: string;
  /** Environment of the host tools: the defined entries of the scenario environment. */
  readonly toolEnv: Readonly<Record<string, string>>;
  /** What the scenario wrote on standard error (the diagnostics of failed assertions). */
  stderr: string;
  index: number;
  notOk: number;
  /** `docker <args>` with the given redirections; returns its exit status. */
  docker(args: readonly string[], out?: DockerOutput): number;
  /** `sub_emit ok|not_ok <description>`. */
  emit(kind: "ok" | "not_ok", description: string): void;
  /** `if assert ...; then ok else not_ok`: the assertion's diagnostics go to standard error. */
  check(result: AssertResult, okText: string, notOkText: string): void;
}

function definedEnv(env: Env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined) out[k] = v;
  return out;
}

function makeScenario(
  ctx: ScenarioCtx,
  tap: ScenarioTap,
  volume: string,
  sidecar: string,
): SidecarScenario {
  const toolEnv = definedEnv(ctx.env);
  const s: SidecarScenario = {
    ctx,
    tap,
    volume,
    sidecar,
    toolEnv,
    stderr: "",
    index: 0,
    notOk: 0,
    docker(args, out = {}) {
      const res = runTool("docker", args, {
        cwd: ctx.scenarioDir,
        env: toolEnv,
        input: out.input ?? "",
      });
      if (out.stdoutFile !== undefined) fs.writeFileSync(out.stdoutFile, res.stdout);
      if (out.stderrFile !== undefined) fs.writeFileSync(out.stderrFile, res.stderr);
      return res.rc;
    },
    emit(kind, description) {
      s.index += 1;
      if (kind === "not_ok") s.notOk += 1;
      tap.emit(kind, description);
    },
    check(result, okText, notOkText) {
      s.stderr += result.stderr;
      s.emit(result.rc === 0 ? "ok" : "not_ok", result.rc === 0 ? okText : notOkText);
    },
  };
  return s;
}

/**
 * The whole frame of a sidecar scenario: required environment (E2E_RUN_ID included), volume and
 * sidecar start, the body, the plan line and the summary, and the cleanup that always runs.
 */
export async function runSidecarScenario(
  script: string,
  name: string,
  volumeSuffix: string,
  env: Env,
  body: (s: SidecarScenario) => Promise<void>,
): Promise<{ status: number; stdout: string; stderr: string }> {
  let s: SidecarScenario | undefined;
  let stdout = "";
  let status = 0;
  try {
    const ctx = scenarioCtx(env, script);
    if (ctx.runId === undefined || ctx.runId === "") {
      throw new ScenarioExit(1, `${script}: E2E_RUN_ID: runner must export E2E_RUN_ID\n`);
    }
    const tap = new ScenarioTap(ctx, name);
    const volume = `crewrig-e2e-mem-${ctx.runId}-${ctx.cli}${volumeSuffix}`;
    s = makeScenario(ctx, tap, volume, `${volume}-sidecar`);
    if (s.docker(["volume", "create", volume]) !== 0) {
      tap.skip(`could not create docker volume ${volume}`);
    }
    const started = s.docker([
      "run",
      "-d",
      "--rm",
      "--name",
      s.sidecar,
      "-v",
      `${volume}:/home/agent/.mempalace`,
      MEMPALACE_IMAGE,
      "sleep",
      "600",
    ]);
    if (started !== 0) {
      const what =
        volumeSuffix === ""
          ? `sidecar ${s.sidecar} (image ${MEMPALACE_IMAGE} missing?)`
          : `sidecar (image ${MEMPALACE_IMAGE} missing?)`;
      tap.skip(`could not start ${what}`);
    }
    await body(s);
    fs.appendFileSync(`${ctx.reportDir}/scenario.tap`, `1..${s.index}\n`);
    if (s.notOk > 0) {
      stdout = `${s.notOk}/${s.index} FAIL — ${ctx.cli}/${name}\n`;
      status = 1;
    } else {
      stdout = `OK — ${ctx.cli}/${name} (${s.index} assertions)\n`;
    }
    return { status, stdout, stderr: s.stderr };
  } catch (error) {
    if (error instanceof ScenarioExit) {
      return {
        status: error.status,
        stdout: s?.tap.stdout ?? "",
        stderr: (s?.stderr ?? "") + error.message,
      };
    }
    throw error;
  } finally {
    if (s !== undefined) {
      s.docker(["rm", "-f", s.sidecar]);
      s.docker(["volume", "rm", "-f", s.volume]);
    }
  }
}

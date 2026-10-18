// scenario-01-layered-context.ts — TypeScript twin of scenarios/01-layered-context/run.sh (spec 0261):
// the 00-60 rule files steer the CLI's answer to a profile-aware probe. Twin of the shell scenario:
// change both, and keep them equal. Env and cwd are parameters; nothing here reads process state.

import fs from "node:fs";
import path from "node:path";

import { assertFileExists } from "./assert.ts";
import { expandMount } from "./expand.ts";
import { findOnPath, runTool } from "./exec.ts";
import { llmJudge } from "./llm_judge.ts";
import { bashQuoteC } from "./mask_command.ts";
import { ScenarioExit, ScenarioTap, scenarioCtx, type Env } from "./scenario.ts";
import { assertStdoutMatches } from "./structural.ts";

export interface ScenarioOutcome {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

const NAME = "01-layered-context";

/** `$(cat file)`: the file's text without its trailing newlines. */
function catText(file: string): string {
  return fs.readFileSync(file, "utf8").replace(/\n+$/, "");
}

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

function bundleNonEmpty(dir: string): boolean {
  try {
    return fs.readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

export async function runScenario01(env: Env, cwd: string): Promise<ScenarioOutcome> {
  let tap: ScenarioTap | undefined;
  let stderr = "";
  try {
    const ctx = scenarioCtx(env, "run.sh");
    tap = new ScenarioTap(ctx, NAME);
    const sEnv = stringEnv(env);
    const ao = { cwd, env: sEnv };
    const { cli, reportDir, scenarioDir } = ctx;
    if (cli !== "claude" && cli !== "gemini" && cli !== "copilot") {
      tap.skip(`unknown CLI '${cli}'`);
    }
    const effective: unknown = JSON.parse(fs.readFileSync(ctx.effectiveJson, "utf8"));
    const cliCmd = listFrom(effective, cli, "command");
    const probeArgv = [...cliCmd, "-p"];
    const probePrompt = catText(path.join(scenarioDir, "probe.prompt"));
    const expectedRe = fs
      .readFileSync(path.join(scenarioDir, "expected.regex"), "utf8")
      .split("\n")[0] as string;

    const rulesDir = path.join(ctx.e2eHome, cli);
    if (!bundleNonEmpty(rulesDir)) {
      tap.skip(`no auth/rules dir at ${rulesDir} (run \`task e2e:auth:${cli}\`)`);
    }

    const hostOut = path.join(reportDir, "out");
    fs.mkdirSync(hostOut, { recursive: true });
    const containerName = `crewrig-e2e-01-${cli}-${ctx.runId || "adhoc"}`;
    const dockerArgs = ["run", "--rm", "--name", containerName, "-v", `${hostOut}:/out`];
    if (cli === "claude") dockerArgs.push("-v", `${rulesDir}:/home/agent/.claude:ro`);
    for (const m of listFrom(effective, cli, "mounts")) {
      const expanded = expandMount(m, ctx.e2eHome, env["HOME"] ?? "");
      dockerArgs.push("-v", expanded.stdout.replace(/\n+$/, ""));
    }
    for (const k of listFrom(effective, cli, "env_keys")) dockerArgs.push("-e", k);
    dockerArgs.push("-e", `E2E_PROBE_PROMPT=${probePrompt}`, ctx.image, ...probeArgv, probePrompt);

    const quoted = ["docker", ...dockerArgs].map((a) => ` ${bashQuoteC(a)}`).join("");
    fs.writeFileSync(
      path.join(reportDir, "invocation.txt"),
      `image: ${ctx.image}\nargv:${quoted}\n`,
    );

    const run = findOnPath("docker", sEnv) === null ? undefined : runTool("docker", dockerArgs, ao);
    const res = run ?? { rc: 127, stdout: "", stderr: "docker: command not found\n" };
    fs.writeFileSync(path.join(reportDir, "probe.stdout"), res.stdout);
    fs.writeFileSync(path.join(reportDir, "probe.stderr"), res.stderr);
    // `if ! cmd; then _probe_rc=$?` reads the status of the negation (0), so the gemini exit-124
    // tolerance of the shell never fires and the message always says "exit 0".
    if (res.rc !== 0) tap.emit("not_ok", "docker run probe exited non-zero (exit 0)");

    const answerFile = path.join(hostOut, "answer.txt");
    let answerSize = 0;
    try {
      answerSize = fs.statSync(answerFile).size;
    } catch {
      answerSize = 0;
    }
    if (answerSize === 0) {
      try {
        fs.copyFileSync(path.join(reportDir, "probe.stdout"), answerFile);
      } catch {
        // cp ... || true
      }
    }

    const exists = assertFileExists(answerFile, ao);
    stderr += exists.stderr;
    tap.emit(
      exists.rc === 0 ? "ok" : "not_ok",
      `side-effect: answer file ${exists.rc === 0 ? "present" : "missing"}`,
    );

    const match = assertStdoutMatches(expectedRe, answerFile, "", ao);
    stderr += match.stderr;
    tap.emit(
      match.rc === 0 ? "ok" : "not_ok",
      `structural: answer ${match.rc === 0 ? "matches" : "does not match"} /${expectedRe}/`,
    );

    const judged = await llmJudge(
      { env, now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) },
      path.join(scenarioDir, "probe.prompt"),
      answerFile,
      catText(path.join(scenarioDir, "judge-criterion.txt")),
    );
    fs.appendFileSync(path.join(reportDir, "judge.log"), judged.stdout + judged.stderr);
    tap.emit(
      judged.status === 0 ? "ok" : "not_ok",
      `llm-judge: profile-awareness criterion ${judged.status === 0 ? "met" : "not met"}`,
    );

    const status = tap.finish();
    return { status, stdout: tap.stdout, stderr };
  } catch (error) {
    if (error instanceof ScenarioExit) {
      return { status: error.status, stdout: tap?.stdout ?? "", stderr: stderr + error.message };
    }
    throw error;
  }
}

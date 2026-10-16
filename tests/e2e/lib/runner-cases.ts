// runner-cases.ts — one (scenario, cli) pair of the e2e runner: the scenario-script delegation
// branch and the legacy direct-docker branch of tests/e2e/run.sh (ADR 0005 Decision 3).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  e2eAssertBundleModes,
  e2eAuthReady,
  e2eE2eHome,
  e2eEnsureBundleDir,
  ExitError,
  type CallResult,
} from "../../../scripts/e2e/lib/auth-common.ts";
import { expandMount } from "./expand.ts";
import { findOnPath } from "./exec.ts";
import { bashQuote } from "./mask_command.ts";
import { obj, strList, type Json, type Tap } from "./runner-config.ts";

export interface RunnerIo {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}

export interface CaseCtx {
  readonly e2eDir: string;
  readonly env: Readonly<Record<string, string>>;
  readonly reportDir: string;
  readonly effectivePath: string;
  readonly effective: Json;
  readonly dryRun: boolean;
  readonly tap: Tap;
  readonly io: RunnerIo;
}

const NODE_FLAG = "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON";
const ENV_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;

const emit = (io: RunnerIo, r: CallResult): void => {
  if (r.stdout !== "") io.out(r.stdout);
  if (r.stderr !== "") io.err(r.stderr);
};

/** Spawn with stdout/stderr redirected to files; the exit status the shell's `$?` would hold. */
function spawnToFiles(file: string, args: readonly string[], env: Json, dir: string): number {
  const out = fs.openSync(path.join(dir, "stdout"), "w");
  const err = fs.openSync(path.join(dir, "stderr"), "w");
  try {
    const res = spawnSync(file, [...args], {
      env: env as NodeJS.ProcessEnv,
      stdio: ["inherit", out, err],
    });
    if (res.error !== undefined) {
      fs.writeSync(err, `${file}: ${res.error.message}\n`);
      return 127;
    }
    if (res.status !== null) return res.status;
    return 128 + (os.constants.signals[res.signal ?? "SIGTERM"] ?? 15);
  } finally {
    fs.closeSync(out);
    fs.closeSync(err);
  }
}

function mapExit(ctx: CaseCtx, desc: string, code: number, dir: string, what: string): number {
  const { tap, io } = ctx;
  if (code === 0) tap.emit("ok", desc);
  else if (code === 78) tap.emit("skip", desc, `${what} reported skip (exit 78)`);
  else {
    tap.emit("not_ok", desc);
    io.err(`[runner] ${desc} failed: exit ${code}\n`);
    io.err(`[runner]   stdout: ${dir}/stdout\n`);
    io.err(`[runner]   stderr: ${dir}/stderr\n`);
    return 1;
  }
  return 0;
}

/** Runs one pair; returns 1 when it contributes a failure to the run exit status. */
export function runCase(ctx: CaseCtx, scenario: string, cli: string): number {
  const { tap, io, env } = ctx;
  const desc = `${cli}/${scenario}`;
  const cliCfg = obj(obj(ctx.effective["cli"])[cli]);
  const ready = e2eAuthReady(env, cli);
  emit(io, { ...ready, stdout: "" });
  if (ready.rc !== 0) {
    tap.emit("skip", desc, `unconfigured (run \`task e2e:auth:${cli}\`)`);
    return 0;
  }
  const credentialPath = ready.credentialPath ?? "unknown";
  const image = String(cliCfg["image"] ?? "null");
  const caseDir = path.join(ctx.reportDir, cli, scenario);
  fs.mkdirSync(caseDir, { recursive: true });
  const scenarioDir = path.join(ctx.e2eDir, "scenarios", scenario);
  const script = path.join(scenarioDir, "run.ts");

  if (fs.existsSync(script)) {
    if (ctx.dryRun) {
      tap.emit("skip", desc, "dry-run");
      return 0;
    }
    emit(io, e2eEnsureBundleDir(env, cli));
    const childEnv: Json = {
      ...env,
      E2E_LIB_DIR: path.join(ctx.e2eDir, "lib"),
      E2E_REPORT_DIR: caseDir,
      E2E_CLI: cli,
      E2E_IMAGE: image,
      E2E_EFFECTIVE_JSON: ctx.effectivePath,
      E2E_CREWRIG_E2E_HOME: e2eE2eHome(env),
      E2E_SCENARIO_DIR: scenarioDir,
      E2E_RUN_ID: path.basename(ctx.reportDir),
      E2E_CREDENTIAL_PATH: credentialPath,
    };
    const code = spawnToFiles(process.execPath, [NODE_FLAG, script], childEnv, caseDir);
    emit(io, e2eAssertBundleModes(env, cli));
    fs.writeFileSync(path.join(caseDir, "exit"), `${code}\n`);
    return mapExit(ctx, desc, code, caseDir, "scenario");
  }

  const home = env["HOME"] ?? "";
  const argv = ["docker", "run", "--rm", "--name", `crewrig-e2e-${scenario}-${cli}`];
  for (const m of strList(cliCfg["mounts"])) {
    const x = expandMount(m, e2eE2eHome(env), home);
    if (x.rc !== 0) throw new ExitError(x.rc, x.stderr);
    argv.push("-v", x.stdout.slice(0, -1));
  }
  for (const k of strList(cliCfg["env_keys"])) {
    if (!ENV_NAME_RE.test(k)) {
      throw new ExitError(
        1,
        `ERROR: invalid env_keys entry '${k}' (must match ^[A-Z_][A-Z0-9_]*$).
`,
      );
    }
    argv.push("-e", k);
  }
  const scenCfg = obj(obj(ctx.effective["scenarios"])[scenario]);
  argv.push(image, ...strList(cliCfg["command"]), ...strList(cliCfg["command_args"]));
  argv.push(...strList(scenCfg["command_args"]));
  fs.writeFileSync(
    path.join(caseDir, "invocation.txt"),
    `image: ${image}\nargv:${argv.map((a) => ` ${bashQuote(a)}`).join("")}\n`,
  );
  if (ctx.dryRun) {
    tap.emit("skip", desc, "dry-run");
    return 0;
  }
  emit(io, e2eEnsureBundleDir(env, cli));
  const docker = findOnPath("docker", env);
  let code: number;
  if (docker === null) {
    fs.writeFileSync(path.join(caseDir, "stdout"), "");
    fs.writeFileSync(path.join(caseDir, "stderr"), "docker: command not found\n");
    code = 127;
  } else code = spawnToFiles(docker, argv.slice(1), env, caseDir);
  emit(io, e2eAssertBundleModes(env, cli));
  fs.writeFileSync(path.join(caseDir, "exit"), `${code}\n`);
  return mapExit(ctx, desc, code, caseDir, "container");
}

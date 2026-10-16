// auth-common.ts — TypeScript twin of scripts/e2e/lib/auth-common.sh (spec 0261 R1-R4, R24).
// Every function takes the environment (and, where the shell ran `docker`, a runner) as a
// parameter and returns what the shell function wrote; a helper that ended in `exit` throws an
// `ExitError` carrying the status and every byte the call wrote to stderr, entries catch it and set
// `process.exitCode`.

import fs from "node:fs";

import { findOnPath, runTool, type ToolResult } from "../../../tests/e2e/lib/exec.ts";

export type Env = Readonly<Record<string, string>>;

export interface CallResult {
  readonly rc: number;
  readonly stdout: string;
  readonly stderr: string;
  /** E2E_AUTH_READY_CREDENTIAL_PATH after `e2e_auth_ready`. */
  readonly credentialPath?: string;
}

/** Runs `docker <args>` the way the shell did; injected so that tests and entries share the twin. */
export type DockerRunner = (args: readonly string[]) => ToolResult;

/** What the shell's `exit` did: its status and everything printed on stderr by the call. */
export class ExitError extends Error {
  readonly status: number;
  readonly stderr: string;
  constructor(status: number, stderr: string) {
    super(stderr);
    this.name = "ExitError";
    this.status = status;
    this.stderr = stderr;
  }
}

export const makeDockerRunner =
  (env: Env, cwd: string): DockerRunner =>
  (args) =>
    runTool("docker", args, { cwd, env });

const info = (...words: readonly string[]): string => `${words.join(" ")}\n`;
export const e2eInfo = (...words: readonly string[]): CallResult => ({
  rc: 0,
  stdout: "",
  stderr: info(...words),
});
const dieText = (words: string): string => `ERROR: ${words}\n`;
export const e2eDie = (...words: readonly string[]): never => {
  throw new ExitError(1, dieText(words.join(" ")));
};
export const e2eSkip = (...words: readonly string[]): never => {
  throw new ExitError(78, `SKIP: ${words.join(" ")}\n`);
};

const die = (msg: string, prior = ""): never => {
  throw new ExitError(1, prior + dieText(msg));
};

export function e2eRequireDocker(env: Env): CallResult {
  if (findOnPath("docker", env) === null) {
    return die("docker is required and was not found on $PATH.");
  }
  return { rc: 0, stdout: "", stderr: "" };
}

export function e2eRequireImage(
  image: string,
  buildHint: string,
  docker: DockerRunner,
): CallResult {
  if (docker(["image", "inspect", image]).rc !== 0) {
    return die(`image '${image}' is not present locally. Build it first: ${buildHint}`);
  }
  return { rc: 0, stdout: "", stderr: "" };
}

export function e2eE2eHome(env: Env): string {
  const base = env.CREWRIG_E2E_HOME;
  return `${base !== undefined && base !== "" ? base : (env.HOME ?? "")}/.crewrig-e2e`;
}

export const e2eCliDir = (env: Env, cli: string): string => `${e2eE2eHome(env)}/${cli}`;

const modeOf = (p: string): string => (fs.statSync(p).mode & 0o777).toString(8);

/** GNU chmod's diagnostic for a failed `chmod <mode> <path>`. */
function chmodDiagnostic(p: string, e: unknown): string {
  const code = (e as NodeJS.ErrnoException).code;
  if (code === "ENOENT") return `chmod: cannot access '${p}': No such file or directory\n`;
  if (code === "EACCES") return `chmod: changing permissions of '${p}': Permission denied\n`;
  return `chmod: changing permissions of '${p}': Operation not permitted\n`;
}

export function e2eEnsureBundleDir(env: Env, cli: string): CallResult {
  const root = e2eE2eHome(env);
  const dir = e2eCliDir(env, cli);
  let err = "";
  fs.mkdirSync(dir, { recursive: true });
  for (const p of [root, dir]) {
    try {
      fs.chmodSync(p, 0o700);
    } catch (e) {
      err += chmodDiagnostic(p, e);
    }
  }
  const check = (p: string, msg: string): void => {
    let mode = "";
    try {
      mode = modeOf(p);
    } catch {
      // stat failed: the comparison below fails the same way
    }
    if (mode !== "700") die(msg, err);
  };
  check(root, `[${cli}] e2e_ensure_bundle_dir: could not chmod 700 the e2e root ${root}.`);
  check(dir, `[${cli}] e2e_ensure_bundle_dir: could not chmod 700 ${dir}.`);
  return { rc: 0, stdout: "", stderr: err };
}

function walk(dir: string, out: { path: string; dir: boolean }[]): void {
  out.push({ path: dir, dir: true });
  for (const name of fs.readdirSync(dir)) {
    const p = `${dir}/${name}`;
    const st = fs.lstatSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (st.isFile()) out.push({ path: p, dir: false });
  }
}

export function e2eAssertBundleModes(env: Env, cli: string): CallResult {
  const dir = e2eCliDir(env, cli);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return { rc: 0, stdout: "", stderr: "" };
  }
  const entries: { path: string; dir: boolean }[] = [];
  walk(dir, entries);
  let err = "";
  for (const e of entries) {
    try {
      fs.chmodSync(e.path, e.dir ? 0o700 : 0o600);
    } catch (x) {
      err += chmodDiagnostic(e.path, x);
    }
  }
  let bad = "";
  for (const e of entries) {
    const mode = modeOf(e.path);
    if ((e.dir && mode !== "700") || (!e.dir && mode !== "600")) bad += `${e.path}(${mode}) `;
  }
  if (bad !== "") {
    return die(
      `[${cli}] e2e_assert_bundle_modes: mode invariant does not hold after chmod — ownership mismatch? offenders: ${bad}(this is expected-but-unverified on native Linux; see the function's header comment)`,
      err,
    );
  }
  return { rc: 0, stdout: "", stderr: err };
}

export function e2eChownBootstrap(env: Env, cli: string, _image: string): CallResult {
  const dir = e2eCliDir(env, cli);
  const uid = env.E2E_AGENT_UID ?? "1000";
  const gid = env.E2E_AGENT_GID ?? "1000";
  let err = info(`[${cli}] Asserting writability on ${dir} (uid:${uid} gid:${gid})…`);
  try {
    fs.chmodSync(dir, 0o777);
  } catch (e) {
    err += chmodDiagnostic(dir, e);
    return die(`[${cli}] writability bootstrap failed — cannot chmod ${dir}.`, err);
  }
  return { rc: 0, stdout: "", stderr: err };
}

const nonEmptyFile = (p: string): boolean => {
  try {
    const st = fs.statSync(p);
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
};
const set = (env: Env, name: string): boolean => (env[name] ?? "") !== "";

export function e2eAuthReady(env: Env, cli: string): CallResult {
  const dir = e2eCliDir(env, cli);
  const ready = (line: string, credentialPath: string): CallResult => ({
    rc: 0,
    stdout: "",
    stderr: info(line),
    credentialPath,
  });
  const notReady = (line: string): CallResult => ({
    rc: 78,
    stdout: "",
    stderr: info(line),
    credentialPath: "",
  });
  const marker = (file: string, key: string): CallResult | null => {
    if (nonEmptyFile(`${dir}/${file}`)) {
      return ready(`[${cli}] auth ready: on-disk marker ${dir}/${file}`, "on-disk-credential");
    }
    if (set(env, key)) {
      return ready(`[${cli}] auth ready: ${key} set in host shell`, key);
    }
    return null;
  };
  if (cli === "claude") {
    return (
      marker(".credentials.json", "ANTHROPIC_API_KEY") ??
      notReady(`[${cli}] auth NOT ready: no marker file, no ANTHROPIC_API_KEY`)
    );
  }
  if (cli === "gemini") {
    return (
      marker("oauth_creds.json", "GEMINI_API_KEY") ??
      notReady(`[${cli}] auth NOT ready: no marker file, no GEMINI_API_KEY`)
    );
  }
  if (cli === "copilot") {
    if (set(env, "COPILOT_GITHUB_TOKEN")) {
      return ready(
        `[${cli}] auth ready: COPILOT_GITHUB_TOKEN set in host shell`,
        "COPILOT_GITHUB_TOKEN",
      );
    }
    if (set(env, "GH_TOKEN")) {
      return ready(`[${cli}] auth ready: GH_TOKEN set in host shell (fallback)`, "GH_TOKEN");
    }
    if (nonEmptyFile(`${dir}/config.json`)) {
      return ready(
        `[${cli}] auth ready: workstation credential ${dir}/config.json`,
        "workstation-credential",
      );
    }
    const key = `${e2eCliDir(env, "ollama")}/id_ed25519`;
    if (nonEmptyFile(key)) {
      return ready(
        `[${cli}] auth ready: Ollama Cloud keypair present (${key})`,
        "ollama-cloud-keypair",
      );
    }
    return notReady(
      `[${cli}] auth NOT ready: no credential found. Start 'copilot' and run '/login' (or \`task e2e:auth:copilot\` to copy the workstation credential into the bundle), or set COPILOT_GITHUB_TOKEN / GH_TOKEN.`,
    );
  }
  return die(`e2e_auth_ready: unknown CLI '${cli}' (expected: claude|gemini|copilot)`);
}

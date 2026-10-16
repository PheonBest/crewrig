// copilot_ephemeral_home.ts — TypeScript twin of tests/e2e/lib/copilot_ephemeral_home.sh (shared
// ephemeral Copilot home staging, spec 0194). Change both, and keep them equal.
//
// The stager takes the environment and the working directory as parameters: relative `bundleDir`
// and `declSrc` resolve against `cwd`, the temporary root comes from `env.TMPDIR` (default /tmp,
// as `${TMPDIR:-/tmp}`). The caller owns the cleanup of the returned staging root.

import fs from "node:fs";
import path from "node:path";

export interface HomeResult {
  readonly rc: number;
  readonly stdout: string;
  readonly stderr: string;
}

const STAGE_LINE = 54;
const MOUNT_LINE = 75;
const PREFIX = "crewrig-e2e-copilot-home.";

const unbound = (libPath: string, line: number, n: number): HomeResult => ({
  rc: 127,
  stdout: "",
  stderr: `${libPath}: line ${line}: $${n}: unbound variable\n`,
});

// Mode tightening of the shell's two `find -exec chmod` passes: directories 0700, files 0600.
function tighten(dir: string): void {
  fs.chmodSync(dir, 0o700);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) tighten(full);
    else if (entry.isFile()) fs.chmodSync(full, 0o600);
  }
}

export function stageCopilotEphemeralHome(
  args: readonly string[],
  env: Readonly<Record<string, string>>,
  cwd: string,
  libPath: string,
): HomeResult {
  if (args.length < 3) return unbound(libPath, STAGE_LINE, args.length + 1);
  const [bundleDir, agentName, declSrc] = args;
  const tmp = env["TMPDIR"] === undefined || env["TMPDIR"] === "" ? "/tmp" : env["TMPDIR"];
  let staging: string;
  try {
    staging = fs.mkdtempSync(path.join(tmp, PREFIX));
  } catch (err) {
    const reason =
      (err as NodeJS.ErrnoException).code === "ENOENT" ? "No such file or directory" : String(err);
    return {
      rc: 1,
      stdout: "",
      stderr:
        `mktemp: failed to create directory via template '${tmp}/${PREFIX}XXXXXX': ${reason}\n` +
        "e2e_stage_copilot_ephemeral_home: mktemp -d failed\n",
    };
  }
  const bundle = path.resolve(cwd, bundleDir);
  if (fs.existsSync(bundle) && fs.statSync(bundle).isDirectory()) {
    try {
      fs.cpSync(bundle, staging, { recursive: true, preserveTimestamps: true });
    } catch {
      // `cp -a ... || true`: a failed copy is not an error.
    }
  }
  fs.mkdirSync(path.join(staging, "agents"), { recursive: true });
  let stderr = "";
  try {
    fs.copyFileSync(path.resolve(cwd, declSrc), path.join(staging, "agents", `${agentName}.md`));
  } catch {
    stderr = `cp: cannot stat '${declSrc}': No such file or directory\n`;
  }
  tighten(staging);
  return { rc: 0, stdout: `${staging}\n`, stderr };
}

export function copilotHomeMountOverride(args: readonly string[], libPath: string): HomeResult {
  if (args.length < 1) return unbound(libPath, MOUNT_LINE, 1);
  const mode = args[1] === undefined || args[1] === "" ? "rw" : args[1];
  return { rc: 0, stdout: `${args[0]}:/home/agent/.copilot:${mode}\n`, stderr: "" };
}

// bash-libs.ts — run a fragment of Bash with the setup libraries sourced
// (spec 0248 R30-R32; plan decision D7). The setups are interactive and cannot
// run in CI (`fzf`), so the library functions they call are driven directly:
// `scripts/lib/common.sh` and `scripts/lib/usage-capture-optin.sh` by default, with HOME
// redirected into a throwaway directory. POSIX only.

import { spawnSync } from "node:child_process";
import path from "node:path";

import { cleanEnv, realTmp, REPO, type Result, which } from "./worktree-fixtures.ts";

const BASH = which("bash") ?? "/bin/bash";

/**
 * Run `body` in a fresh `bash -c` that has sourced the libraries (`libs`, file
 * names under `scripts/lib/`; default both setup libraries) with
 * `INSTALL_MODE=copy` and a throwaway HOME. `env` replaces the child's
 * environment (default: the parent's, minus Node.js options).
 */
export const DEFAULT_LIBS: readonly string[] = ["common.sh", "usage-capture-optin.sh"];

export function bashLibs(
  body: string,
  env: NodeJS.ProcessEnv = cleanEnv(),
  libs: readonly string[] = DEFAULT_LIBS,
): Result {
  const home = realTmp("crewrig-bash-home-");
  const script = [
    "set +e",
    'INSTALL_MODE="copy"',
    ...libs.map((lib) => `source ${JSON.stringify(path.join(REPO, "scripts", "lib", lib))}`),
    body,
  ].join("\n");
  const res = spawnSync(BASH, ["-c", script], {
    encoding: "utf8",
    cwd: home,
    env: { ...env, HOME: home },
  });
  return { status: res.status, signal: res.signal, stdout: res.stdout, stderr: res.stderr };
}

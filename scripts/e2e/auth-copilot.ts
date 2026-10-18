// auth-copilot.ts — TypeScript twin of scripts/e2e/auth-copilot.sh (issue #77, spec 0261).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { findOnPath } from "../../tests/e2e/lib/exec.ts";
import {
  e2eAssertBundleModes,
  e2eCliDir,
  e2eDie,
  e2eRequireDocker,
  e2eRequireImage,
  makeDockerRunner,
  type Env,
} from "./lib/auth-common.ts";
import { emit, globFiles, guarded, say, toEnv } from "./lib/auth-helpers.ts";

const CLI = "copilot";
const IMAGE = `crewrig/e2e-${CLI}:latest`;

const BANNER = `================================================================================
 e2e auth — GitHub Copilot CLI (PAT-based, v1)
================================================================================
Copilot CLI in our containers reads its credential from the env var
COPILOT_GITHUB_TOKEN at run time (precedence: COPILOT_GITHUB_TOKEN >
GITHUB_TOKEN > GH_TOKEN). Layered-context rule files are written under
~/.crewrig-e2e/copilot/instructions/ by this script (see issue #120).

Steps (do these on your host, in the shell you will run scenarios from):

  1. Sign into the dedicated TEST GitHub account (NOT your personal one).
  2. Mint a fine-grained PAT:
       https://github.com/settings/personal-access-tokens/new
     Recommended scopes (per ADR 0002 Decision 4):
       - Resource owner   : the test account
       - Repository access: "Public repositories (read-only)" is sufficient
                            for scenario coverage. Tighten further per policy.
       - Permissions      : Copilot — Read & write
                            (no other repo or account scopes required)
     Expiry: fine-grained PATs default to 90 DAYS. Rotate quarterly; CI will
     silently start failing without a calendar reminder.
  3. Add to your shell rc (zsh: ~/.zshrc, bash: ~/.bashrc):

       export COPILOT_GITHUB_TOKEN="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

     Then \`source\` it (or open a new shell). Verify with:

       echo "\${COPILOT_GITHUB_TOKEN:0:4}…  (length=\${#COPILOT_GITHUB_TOKEN})"

  4. Re-run \`task e2e:auth:copilot\` to trigger the sanity test below.
================================================================================
`;

/** `docker run ... copilot --version >/dev/null 2>&1`: stdin inherited, both output streams discarded. */
function sanityRun(env: Env): boolean {
  const exe = findOnPath("docker", env);
  if (exe === null) return false;
  const res = spawnSync(
    exe,
    ["run", "--rm", "-e", "COPILOT_GITHUB_TOKEN", IMAGE, "copilot", "--version"],
    { env: { ...env }, stdio: ["inherit", "ignore", "ignore"], shell: false },
  );
  return res.status === 0;
}

export function runAuthCopilot(env: Env): number {
  const home = env["HOME"] ?? "";
  const hostInstructions = `${home}/.copilot/instructions`;
  const dir = e2eCliDir(env, CLI);
  const docker = makeDockerRunner(env, process.cwd());
  const rulesDir = `${dir}/instructions`;

  if (!fs.existsSync(hostInstructions) || !fs.statSync(hostInstructions).isDirectory()) {
    e2eDie(
      `[${CLI}] ~/.copilot/instructions/ not found. Run \`task setup:copilot\` first to deploy layered-context files.`,
    );
  }
  say(`[${CLI}] Populating ${rulesDir} from ${hostInstructions}…`);
  fs.mkdirSync(rulesDir, { recursive: true });
  const files = globFiles(hostInstructions, ".instructions.md");
  if (files.length === 0) {
    e2eDie(
      `[${CLI}] No *.instructions.md files found in ${hostInstructions}. Run \`task setup:copilot\` to deploy them.`,
    );
  }
  for (const f of files) fs.copyFileSync(path.join(hostInstructions, f), path.join(rulesDir, f));
  say(`[${CLI}] Copied ${files.length} instruction file(s) → ${rulesDir}.`);

  const hostConfig = `${home}/.copilot/config.json`;
  if (fs.existsSync(hostConfig) && fs.statSync(hostConfig).isFile()) {
    fs.copyFileSync(hostConfig, `${dir}/config.json`);
    say(`[${CLI}] Copied config.json → ${dir}/config.json.`);
  } else {
    say(
      `[${CLI}] WARNING: ~/.copilot/config.json not found. Containers will rely on COPILOT_GITHUB_TOKEN only.`,
    );
  }

  emit(e2eAssertBundleModes(env, CLI));

  process.stderr.write(BANNER);

  const token = env["COPILOT_GITHUB_TOKEN"] ?? "";
  if (token === "") {
    say("");
    say(
      `[${CLI}] COPILOT_GITHUB_TOKEN is not set in this shell. Follow the steps above, then re-run.`,
    );
    return 0;
  }

  emit(e2eRequireDocker(env));
  emit(e2eRequireImage(IMAGE, "task e2e:build:copilot", docker));

  say("");
  say(`[${CLI}] COPILOT_GITHUB_TOKEN detected (length=${token.length}). Running sanity test…`);

  if (sanityRun(env)) {
    say(`[${CLI}] OK — image launches and accepts the env var.`);
    say(`[${CLI}] Quarterly reminder: fine-grained PATs expire in 90 days. Rotate before then.`);
    return 0;
  }
  say(`[${CLI}] WARNING: \`copilot --version\` exited non-zero inside the image.`);
  say(`[${CLI}] Re-run with: docker run --rm -e COPILOT_GITHUB_TOKEN ${IMAGE} copilot --version`);
  say(`[${CLI}] to see the full error and confirm the token is valid for the test account.`);
  return 1;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename) {
  process.exitCode = guarded(() => runAuthCopilot(toEnv(process.env)));
}

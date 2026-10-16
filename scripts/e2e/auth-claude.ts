// auth-claude.ts — TypeScript twin of scripts/e2e/auth-claude.sh (issue #77, spec 0261).
//
// Interactive `claude /login` inside a TTY-attached container with the per-CLI bundle directory
// bind-mounted read-write; populates ~/.crewrig-e2e/claude/rules from ~/.claude/rules.

import fs from "node:fs";
import path from "node:path";

import {
  e2eAssertBundleModes,
  e2eChownBootstrap,
  e2eCliDir,
  e2eDie,
  e2eRequireDocker,
  e2eRequireImage,
  makeDockerRunner,
  type Env,
} from "./lib/auth-common.ts";
import {
  dockerInteractive,
  emit,
  globFiles,
  guarded,
  reportMissing,
  say,
  toEnv,
} from "./lib/auth-helpers.ts";

// ---------------------------------------------------------------------------------------------
// the entry
// ---------------------------------------------------------------------------------------------

const CLI = "claude";
const IMAGE = `crewrig/e2e-${CLI}:latest`;

export function runAuthClaude(env: Env): number {
  const dir = e2eCliDir(env, CLI);
  const docker = makeDockerRunner(env, process.cwd());
  emit(e2eRequireDocker(env));
  emit(e2eRequireImage(IMAGE, "task e2e:build:claude", docker));

  say(`[${CLI}] Preparing ${dir}…`);
  fs.mkdirSync(dir, { recursive: true });
  fs.closeSync(fs.openSync(path.join(dir, ".claude.json"), "a"));

  const hostRules = `${env["HOME"] ?? ""}/.claude/rules`;
  const rulesDir = `${dir}/rules`;
  if (!fs.existsSync(hostRules) || !fs.statSync(hostRules).isDirectory()) {
    e2eDie(
      `[${CLI}] ~/.claude/rules/ not found. Run \`task setup:claude\` (or the interactive equivalent) first to deploy layered-context files.`,
    );
  }
  say(`[${CLI}] Populating ${rulesDir} from ${hostRules}…`);
  fs.mkdirSync(rulesDir, { recursive: true });
  const files = globFiles(hostRules, ".md");
  if (files.length === 0) {
    e2eDie(
      `[${CLI}] No *.md files found in ${hostRules}. Run \`task setup:claude\` to deploy them.`,
    );
  }
  for (const f of files) fs.copyFileSync(path.join(hostRules, f), path.join(rulesDir, f));
  say(`[${CLI}] Copied ${files.length} rule file(s) → ${rulesDir}.`);

  emit(e2eChownBootstrap(env, CLI, IMAGE));

  say(`[${CLI}] Launching interactive login. Complete the browser OAuth flow on the host.`);
  say(`[${CLI}] (Press Ctrl-D inside the prompt when Claude reports a successful login.)`);
  const rc = dockerInteractive(env, [
    "run",
    "--rm",
    "-it",
    "-v",
    `${dir}:/home/agent/.${CLI}`,
    "-v",
    `${dir}/.claude.json:/home/agent/.claude.json`,
    IMAGE,
    "claude",
    "/login",
  ]);
  if (rc !== 0) {
    e2eDie(
      `[${CLI}] interactive container exited non-zero. Re-run after resolving the error above.`,
    );
  }

  emit(e2eAssertBundleModes(env, CLI));

  if (
    reportMissing(
      CLI,
      dir,
      [".credentials.json", ".claude.json"],
      `[${CLI}] The login flow may not have completed. Re-run \`task e2e:auth:claude\` after authenticating in the browser.`,
    )
  ) {
    return 1;
  }

  let creds = "";
  try {
    creds = fs.readFileSync(`${dir}/.credentials.json`, "latin1");
  } catch {
    // grep 2>/dev/null: an unreadable file is "no match"
  }
  if (creds.includes("ANTHROPIC_API_KEY")) {
    e2eDie(
      `[${CLI}] '${dir}/.credentials.json' contains ANTHROPIC_API_KEY material — API keys MUST be passed via the host shell env at scenario run time, never persisted. Delete the file and re-run.`,
    );
  }

  say(`[${CLI}] Authenticated. Credentials persisted under ${dir}.`);
  say(`[${CLI}] Next: run scenarios with the dir mounted read-only (issue #78).`);
  return 0;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename) {
  process.exitCode = guarded(() => runAuthClaude(toEnv(process.env)));
}

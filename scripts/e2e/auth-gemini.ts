// auth-gemini.ts — TypeScript twin of scripts/e2e/auth-gemini.sh (issue #77, spec 0261).

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
import { dockerInteractive, emit, guarded, reportMissing, say, toEnv } from "./lib/auth-helpers.ts";

const CLI = "gemini";
const IMAGE = `crewrig/e2e-${CLI}:latest`;
const KEY_SHAPE = /(GEMINI|GOOGLE)_API_KEY[ \t\v\f\r]*=[ \t\v\f\r]*[A-Za-z0-9_-]{16,}/;

/** `find DIR -maxdepth 2 -type f ( -name '*.bak' -o -name '*.ori' -o -name '*.orig' ) -delete`. */
function deleteLeftovers(dir: string, depth: number): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isFile()) {
      if (/\.(bak|ori|orig)$/.test(entry.name)) fs.unlinkSync(full);
    } else if (entry.isDirectory() && depth < 2) {
      deleteLeftovers(full, depth + 1);
    }
  }
}

/** `grep -rlE <KEY_SHAPE> DIR | grep -q .`: regular files only, line-oriented, errors ignored. */
function hasKeyMaterial(dir: string): boolean {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (hasKeyMaterial(full)) return true;
    } else if (entry.isFile()) {
      try {
        if (KEY_SHAPE.test(fs.readFileSync(full, "latin1"))) return true;
      } catch {
        // unreadable: grep 2>/dev/null
      }
    }
  }
  return false;
}

export function runAuthGemini(env: Env): number {
  const dir = e2eCliDir(env, CLI);
  const docker = makeDockerRunner(env, process.cwd());
  emit(e2eRequireDocker(env));
  emit(e2eRequireImage(IMAGE, "task e2e:build:gemini", docker));

  say(`[${CLI}] Preparing ${dir}…`);
  fs.mkdirSync(dir, { recursive: true });

  emit(e2eChownBootstrap(env, CLI, IMAGE));

  say(
    `[${CLI}] Launching Gemini CLI. In the menu, pick "Login with Google" and complete the browser flow.`,
  );
  say(`[${CLI}] Once you see the welcome prompt, type "/quit" (or Ctrl-D) to exit.`);

  const rc = dockerInteractive(env, [
    "run",
    "--rm",
    "-it",
    "-v",
    `${dir}:/home/agent/.${CLI}`,
    IMAGE,
    "gemini",
  ]);
  if (rc !== 0) {
    e2eDie(
      `[${CLI}] interactive container exited non-zero. Re-run after resolving the error above.`,
    );
  }

  fs.chmodSync(dir, 0o700);

  for (const sub of ["antigravity-browser-profile", "antigravity", "tmp"]) {
    fs.rmSync(path.join(dir, sub), { recursive: true, force: true });
  }
  deleteLeftovers(dir, 1);

  emit(e2eAssertBundleModes(env, CLI));

  if (
    reportMissing(
      CLI,
      dir,
      ["oauth_creds.json", "settings.json"],
      `[${CLI}] The login flow may not have completed. Re-run \`task e2e:auth:gemini\` and finish the browser step.`,
    )
  ) {
    return 1;
  }

  if (hasKeyMaterial(dir)) {
    e2eDie(
      `[${CLI}] API-key material detected under ${dir} — API keys MUST be passed via the host shell env at scenario run time, never persisted. Delete the offending file(s) and re-run.`,
    );
  }

  say(`[${CLI}] Authenticated. Credentials persisted under ${dir} (mode 0700; files 0600).`);
  say(
    `[${CLI}] Bundle contains a long-lived OAuth refresh token. Treat ${dir} like ~/.ssh — host-only, never sync to cloud storage, never ship in container images.`,
  );
  say(
    `[${CLI}] Next: run scenarios with the dir mounted read-only at /run/gemini-creds (issue #78).`,
  );
  return 0;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename) {
  process.exitCode = guarded(() => runAuthGemini(toEnv(process.env)));
}

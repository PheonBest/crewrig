// auth-ollama.ts — TypeScript twin of scripts/e2e/auth-ollama.sh (issue #114, spec 0261).

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

const CLI = "ollama";
const IMAGE = "crewrig/e2e-copilot:latest";

/** `find DIR -type f -iname '*api*key*'`: any regular file (symlinks not followed) at any depth. */
function hasApiKeyLikeFile(dir: string): boolean {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (hasApiKeyLikeFile(full)) return true;
    } else if (entry.isFile() && /api.*key/i.test(entry.name)) {
      return true;
    }
  }
  return false;
}

export function runAuthOllama(env: Env): number {
  const dir = e2eCliDir(env, CLI);
  const docker = makeDockerRunner(env, process.cwd());
  emit(e2eRequireDocker(env));
  emit(e2eRequireImage(IMAGE, "task e2e:build:copilot", docker));

  say(`[${CLI}] Preparing ${dir}…`);
  fs.mkdirSync(dir, { recursive: true });

  emit(e2eChownBootstrap(env, CLI, IMAGE));

  say(
    `[${CLI}] Launching \`ollama signin\`. Complete the browser flow on the host using the DEDICATED TEST ACCOUNT on ollama.com.`,
  );
  say(`[${CLI}] (The CLI will print a URL; open it on the host, approve, then return here.)`);

  const rc = dockerInteractive(env, [
    "run",
    "--rm",
    "-it",
    "-v",
    `${dir}:/home/agent/.${CLI}`,
    IMAGE,
    "bash",
    "-c",
    "ollama serve >/dev/null 2>&1 & sleep 2 && ollama signin",
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
      ["id_ed25519", "id_ed25519.pub"],
      `[${CLI}] The signin flow may not have completed. Re-run \`task e2e:auth:ollama\` after authorising in the browser.`,
    )
  ) {
    return 1;
  }

  if (hasApiKeyLikeFile(dir)) {
    e2eDie(
      `[${CLI}] API-key-like file detected under ${dir} — Ollama auth uses an Ed25519 keypair, not an API key. Delete the offending file and re-run.`,
    );
  }

  say(`[${CLI}] Authenticated. Ed25519 keypair persisted under ${dir}.`);
  say(`[${CLI}] Next: scenarios that set OLLAMA_HOST will use this keypair (RO mount).`);
  return 0;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename) {
  process.exitCode = guarded(() => runAuthOllama(toEnv(process.env)));
}

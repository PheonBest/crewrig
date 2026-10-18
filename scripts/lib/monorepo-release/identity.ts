// identity.ts — the release commit's identity (spec 0213 R9, spec 0257 R13). Port of
// release_identity. GitHub: exactly the identity the workflow's former `Configure Git` step set,
// unless the caller already set one (`:=` also replaces an empty value). GitLab: nothing is set,
// so the release core falls back to its own `semantic-release-bot` identity.

import type { Forge } from "./forge.ts";

const BOT = "github-actions[bot]";
const BOT_EMAIL = "github-actions[bot]@users.noreply.github.com";

/** The GIT_* entries to export; the caller merges them, this never mutates process.env. */
export function applyIdentity(forge: Forge, env: NodeJS.ProcessEnv): Record<string, string> {
  if (forge !== "github") return {};
  const defaults: Record<string, string> = {
    GIT_AUTHOR_NAME: BOT,
    GIT_AUTHOR_EMAIL: BOT_EMAIL,
    GIT_COMMITTER_NAME: BOT,
    GIT_COMMITTER_EMAIL: BOT_EMAIL,
  };
  const out: Record<string, string> = {};
  for (const [name, fallback] of Object.entries(defaults)) {
    const current = env[name] ?? "";
    out[name] = current === "" ? fallback : current;
  }
  return out;
}

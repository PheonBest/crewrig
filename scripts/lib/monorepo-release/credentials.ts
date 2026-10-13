// credentials.ts — the release credential and the credential-name rule (spec 0213 R11, spec
// 0257 R18). Port of release_is_credential_name, release_strip_args, release_token_usable,
// release_credential and release_disable_credential_helpers. A credential VALUE is never put in
// a message: refusals only name the variable.

import type { Forge } from "./forge.ts";
import { ReleaseRefusal } from "./refusal.ts";

const CREDENTIAL_SUBSTRINGS = ["token", "password", "credential", "secret", "private"];

/**
 * The release core's own masking rule (semantic-release lib/hide-sensitive.js:
 * /token|password|credential|secret|private/i), plus CI_REPOSITORY_URL, which GitLab CI exports
 * with the job token embedded (plan review v2-F2).
 */
export function isCredentialName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === "ci_repository_url" || CREDENTIAL_SUBSTRINGS.some((s) => lower.includes(s));
}

/** A copy of the environment without credential-named variables (replaces `env -u NAME ...`). */
export function stripCredentials(env: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(env)) {
    if (!isCredentialName(name)) out[name] = value;
  }
  return out;
}

/** Usable: non-empty and not a literal `$NAME` left behind by a CI engine that did not expand it. */
export function tokenUsable(value: string | undefined): boolean {
  return value !== undefined && value !== "" && !value.startsWith("$");
}

/**
 * Publish mode only. The credential crosses the two CI engines under the one reference key
 * RELEASE_TOKEN; the forge's own variable names win when already usable. Returns the entry to
 * export, or nothing when the forge's own variables already carry it.
 */
export function resolveCredential(forge: Forge, env: NodeJS.ProcessEnv): Record<string, string> {
  const own = forge === "github" ? "GITHUB_TOKEN" : "GITLAB_TOKEN";
  const alias = forge === "github" ? "GH_TOKEN" : "GL_TOKEN";
  if (tokenUsable(env[own]) || tokenUsable(env[alias])) return {};
  const shared = env["RELEASE_TOKEN"];
  if (tokenUsable(shared) && shared !== undefined) return { [own]: shared };
  throw new ReleaseRefusal(
    forge === "github"
      ? "no release credential: set GITHUB_TOKEN (or RELEASE_TOKEN)"
      : "no release credential: set the masked CI/CD variable GITLAB_TOKEN (or RELEASE_TOKEN)",
  );
}

/**
 * GitLab publish mode only (plan review v2-F5): an empty `credential.helper` resets the helper
 * list, so the push authenticates with GITLAB_TOKEN only and not the runner's job-token helper.
 * The entry is appended after any GIT_CONFIG_* entry the caller already declared.
 */
export function credentialHelperOverrides(env: NodeJS.ProcessEnv): Record<string, string> {
  const raw = env["GIT_CONFIG_COUNT"] ?? "";
  const index = /^[0-9]+$/.test(raw) ? Number(raw) : 0;
  return {
    [`GIT_CONFIG_KEY_${index}`]: "credential.helper",
    [`GIT_CONFIG_VALUE_${index}`]: "",
    GIT_CONFIG_COUNT: String(index + 1),
  };
}

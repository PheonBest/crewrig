// forge.ts — which forge the run is on, and the variables that forge must provide (spec 0213
// R10, spec 0257 R13). Port of release_detect_forge, release_forge_url and the forge-variable
// check of scripts/monorepo-release.sh.

import { ReleaseRefusal } from "./refusal.ts";

export type Forge = "github" | "gitlab";

/**
 * Gitea Actions is tested first because its runner ALSO exports GITHUB_ACTIONS=true for action
 * compatibility; testing GITHUB_ACTIONS first would silently treat a Gitea run as a GitHub one.
 */
export function detectForge(env: NodeJS.ProcessEnv): Forge {
  if (env["GITEA_ACTIONS"] === "true") {
    throw new ReleaseRefusal("unsupported release forge: gitea");
  }
  const github = env["GITHUB_ACTIONS"] === "true";
  const gitlab = env["GITLAB_CI"] === "true";
  if (github && gitlab) {
    throw new ReleaseRefusal("unsupported release forge: ambiguous (github+gitlab)");
  }
  if (github) return "github";
  if (gitlab) return "gitlab";
  if (env["CI"] === "true") {
    throw new ReleaseRefusal("unsupported release forge: unknown CI");
  }
  throw new ReleaseRefusal("unsupported release forge: none (not a CI environment)");
}

/** Refuse when a variable the forge must provide is unset or empty, in the shell's order. */
export function requireForgeVariables(forge: Forge, env: NodeJS.ProcessEnv): void {
  const names =
    forge === "gitlab"
      ? ["CI_PROJECT_URL", "CI_SERVER_URL"]
      : ["GITHUB_SERVER_URL", "GITHUB_REPOSITORY"];
  for (const name of names) {
    if ((env[name] ?? "") === "") throw new ReleaseRefusal(`${name} is not set`);
  }
}

/** The forge's own clone URL of this project, credential-free. */
export function forgeUrl(forge: Forge, env: NodeJS.ProcessEnv): string {
  if (forge === "github") {
    return `${env["GITHUB_SERVER_URL"] ?? ""}/${env["GITHUB_REPOSITORY"] ?? ""}.git`;
  }
  return `${env["CI_PROJECT_URL"] ?? ""}.git`;
}

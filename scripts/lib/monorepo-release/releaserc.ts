// releaserc.ts — the engine configuration (`.releaserc.json`), spec 0257 R15.
//
// LOCKSTEP ORDERING (spec 0044): `@semantic-release/exec` MUST precede
// `@semantic-release/git`, so the manifests are rewritten before the release
// commit stages them. GitHub publish runs after the release PR merged: the
// committed manifests already carry the version, so no changelog and no git
// leg (issue #1379). Keys keep the shell's order: extends, branches, tagFormat,
// plugins, then repositoryUrl last when non-empty.

import path from "node:path";

import { prepareCmd, syncCmd } from "./prepare-cmd.ts";
import { configPath, gitLeg, gitmojiEntry, publishLeg } from "./releaserc-legs.ts";
import type { PluginEntry, Releaserc, ReleasercInput } from "./releaserc-types.ts";

// The engine's own placeholder, not a template literal of ours.
const ENGINE_VERSION = "${nextRelease.version}";

// Rehearsal and prepare read the real forge URL (the note generator derives
// owner, repository and host from it); GitHub publish has none.
function repositoryUrl(input: ReleasercInput): string {
  if (input.forge === "gitlab") return `${input.env["CI_PROJECT_URL"] ?? ""}.git`;
  if (input.mode === "publish") return "";
  return `${input.env["GITHUB_SERVER_URL"] ?? ""}/${input.env["GITHUB_REPOSITORY"] ?? ""}.git`;
}

/** The configuration, serialised as the shell's `jq` does (two spaces, trailing newline). */
export function emitReleaserc(input: ReleasercInput): string {
  const platform = input.platform ?? process.platform;
  // Plain concatenation, as the shell does: a normalising join would rewrite an unusual libDir.
  const notesDir = `${configPath(input.libDir, platform)}/release-notes`;
  const tagOnly = input.forge === "github" && input.mode === "publish";
  const execCmd =
    input.mode === "prepare"
      ? syncCmd({ root: input.root, version: ENGINE_VERSION, platform })
      : prepareCmd({
          root: input.root,
          ext: input.ext,
          out: input.out,
          version: ENGINE_VERSION,
          platform,
        });
  const out = configPath(input.out, platform);
  const plugins: PluginEntry[] = [gitmojiEntry(input, `${notesDir}/gitmoji-esm-shim.mjs`)];
  if (!tagOnly) plugins.push(`${notesDir}/changelog-plugin.ts`);
  plugins.push(["@semantic-release/exec", { prepareCmd: execCmd }]);
  plugins.push(...publishLeg(input, out));
  if (!tagOnly) plugins.push(gitLeg(input));
  const config: Releaserc = {
    extends: "semantic-release-monorepo",
    branches: [input.branch],
    tagFormat: `${input.ext}-v\${version}`,
    plugins,
  };
  const url = repositoryUrl(input);
  if (url !== "") config.repositoryUrl = url;
  return `${JSON.stringify(config, null, 2)}\n`;
}

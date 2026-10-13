// release-blackbox-helpers.ts — shared environments, capture readers and normalisers of the release
// driver black-box suites (spec 0257 R22). Everything here reads what the capturing stubs recorded;
// nothing depends on which implementation (shell or TypeScript) produced it.

import fs from "node:fs";
import path from "node:path";

import { createReleaseSandbox } from "./release-driver-sandbox.ts";
import type { ReleaseSandbox } from "./release-driver-sandbox.ts";

export const GITHUB_ENV = {
  GITHUB_ACTIONS: "true",
  GITHUB_SERVER_URL: "https://github.com",
  GITHUB_REPOSITORY: "acme/crewrig",
  // The release-PR sync of a GitHub publish calls this API: a closed local port keeps it offline.
  GITHUB_API_URL: "http://127.0.0.1:1",
} as const;

export const GITLAB_ENV = {
  GITLAB_CI: "true",
  CI_PROJECT_URL: "https://gitlab.example.test/acme/crewrig",
  CI_SERVER_URL: "https://gitlab.example.test",
  CI_COMMIT_BRANCH: "main",
  CI_PIPELINE_SOURCE: "push",
} as const;

export const FORGE_ENV = { github: GITHUB_ENV, gitlab: GITLAB_ENV } as const;
export type Forge = keyof typeof FORGE_ENV;

/** Run `body` against a fresh sandbox and dispose it, whatever the outcome. */
export function withSandbox(body: (sb: ReleaseSandbox) => void): void {
  const sb = createReleaseSandbox();
  try {
    body(sb);
  } finally {
    sb.dispose();
  }
}

/** The version `package.json` of an extension commits: what makes the classifier say `publish`. */
export function manifestVersion(sb: ReleaseSandbox, ext: string): string {
  const file = path.join(sb.root, "extensions", "core", ext, "package.json");
  return (JSON.parse(fs.readFileSync(file, "utf8")) as { version: string }).version;
}

/** Script the engine's dry run so `hello-world` classifies as `publish` and the rest as unchanged. */
export function scriptHelloWorldPublish(sb: ReleaseSandbox): void {
  const version = manifestVersion(sb, "hello-world");
  sb.scriptRehearse({
    "hello-world": {
      released: true,
      version,
      gitTag: `hello-world-v${version}`,
      lastTag: `hello-world-v${version}`,
      notes: "## Notes",
    },
    "second-ext": { released: false },
  });
}

/** Every file named `name` under `root`, skipping `.git` and `node_modules` (found by walking). */
export function findNamed(root: string, name: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === name) found.push(full);
    }
  };
  walk(root);
  return found;
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Recursive key sort, the equivalent of `jq -S`. */
export function canonical(value: Json): Json {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    const out: { [key: string]: Json } = {};
    for (const key of Object.keys(value).sort()) out[key] = canonical(value[key] as Json);
    return out;
  }
  return value;
}

export interface Releaserc {
  extends: string;
  branches: string[];
  tagFormat: string;
  repositoryUrl?: string;
  plugins: (string | [string, Record<string, unknown>])[];
}

/** The plugin entries whose name is `name`. */
export function pluginsNamed(config: Releaserc, name: string): [string, Record<string, unknown>][] {
  return config.plugins.filter(
    (p): p is [string, Record<string, unknown>] => Array.isArray(p) && p[0] === name,
  );
}

/** The configuration `npx semantic-release` was started with, for extension `ext`. */
export function npxConfig(sb: ReleaseSandbox, ext: string): Releaserc {
  const calls = sb.readJsonl("npx").filter((c) => c["ext"] === ext);
  if (calls.length !== 1) throw new Error(`expected one npx call for ${ext}, got ${calls.length}`);
  return JSON.parse(String(calls[0]?.["extendsContent"])) as Releaserc;
}

/** The configuration the rehearsal helper was given for extension `ext`. */
export function rehearseConfig(sb: ReleaseSandbox, ext: string): Releaserc {
  const calls = sb.readJsonl("rehearse").filter((c) => c["ext"] === ext);
  if (calls.length !== 1)
    throw new Error(`expected one rehearse call for ${ext}, got ${calls.length}`);
  return JSON.parse(String(calls[0]?.["config"])) as Releaserc;
}

/** The recorded environment of the stub's call number `index`. */
export function recordedEnv(
  sb: ReleaseSandbox,
  stub: "npx" | "rehearse",
  index: number,
): Record<string, string> {
  return (sb.readJsonl(stub)[index]?.["env"] ?? {}) as Record<string, string>;
}

/** Replace the sandbox paths by placeholders, library directory first (it sits under the root). */
export function normalisePaths(text: string, sb: ReleaseSandbox): string {
  return text
    .split(path.join(sb.root, "scripts", "lib"))
    .join("<LIBDIR>")
    .split(sb.root)
    .join("<ROOT>");
}

/**
 * The GitHub publish configuration as the golden stores it: canonical key order, sandbox paths
 * as placeholders, and the exec `prepareCmd` blanked (deviation (b) of the spec: it changes in
 * the TypeScript port). Two-space JSON and one final newline.
 */
export function goldenForm(config: Releaserc, sb: ReleaseSandbox): string {
  const copy = JSON.parse(normalisePaths(JSON.stringify(config), sb)) as Releaserc;
  for (const entry of pluginsNamed(copy, "@semantic-release/exec")) entry[1]["prepareCmd"] = "";
  return `${JSON.stringify(canonical(copy as unknown as Json), null, 2)}\n`;
}

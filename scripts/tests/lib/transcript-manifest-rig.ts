// transcript-manifest-rig.ts — shared rig of the three session-recording manifest suites
// (setup-transcript-{claude,gemini,copilot}.test.ts, spec 0263 pull request B). It reads the shipped
// `hooks/<cli>-transcript-hooks.json`, renders it through the real entry
// (`scripts/usage-capture-optin.ts render-session-recording-manifest`, the step the setup scripts run)
// under a scratch HOME / USERPROFILE / CREWRIG_USAGE_ROOT, and offers the flat views the assertions need.
// The repository is the checkout this file lives in, so a mutated copy of the tree tests itself.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };
export type TranscriptCli = "claude" | "gemini" | "copilot";

export const REPO = fs.realpathSync(path.resolve(import.meta.dirname, "../../.."));
/** `pwd -P` of `hooks/`: the physical directory the render step writes into every command. */
export const HOOKS_REAL = fs.realpathSync(path.join(REPO, "hooks"));
export const POSIX_ONLY =
  process.platform === "win32" ? "Windows command form is pinned elsewhere" : false;

export const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function manifestPath(cli: TranscriptCli): string {
  return path.join(REPO, "hooks", `${cli}-transcript-hooks.json`);
}

export function readJson(file: string): Json {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Json;
}

export function readManifest(cli: TranscriptCli): Json {
  return readJson(manifestPath(cli));
}

/** A scratch directory under the real temporary root, removed by `cleanScratch`. */
const made: string[] = [];
export function scratch(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-transcript-rig-")));
  made.push(dir);
  return dir;
}
export function cleanScratch(): void {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

export interface Rendered {
  readonly status: number | null;
  readonly err: string;
  readonly file: string;
  readonly text: string;
  readonly json: Json;
}

/** Scratch environment: nothing of a real HOME, no daemon, no port. */
function scratchEnv(dir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("MEMPALACE_")) delete env[key];
  return { ...env, HOME: dir, USERPROFILE: dir, CREWRIG_USAGE_ROOT: path.join(dir, "usage") };
}

export function runEntry(
  dir: string,
  args: readonly string[],
): { status: number | null; err: string } {
  const run = spawnSync(
    process.execPath,
    [path.join(REPO, "scripts/usage-capture-optin.ts"), ...args],
    {
      cwd: dir,
      env: scratchEnv(dir),
      encoding: "utf8",
      input: "",
    },
  );
  return { status: run.status, err: run.stderr };
}

/** The setup's render step over the shipped manifest of `cli`; the output is read back as text and JSON. */
export function renderManifest(cli: TranscriptCli): Rendered {
  const dir = scratch();
  const file = path.join(dir, "rendered.json");
  const run = runEntry(dir, [
    "render-session-recording-manifest",
    cli,
    REPO,
    manifestPath(cli),
    file,
  ]);
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  return { ...run, file, text, json: text === "" ? null : (JSON.parse(text) as Json) };
}

/** Every handler object of a manifest (nested `hooks[]` groups or flat arrays), at any depth. */
export function commandObjects(json: Json): JsonObject[] {
  if (Array.isArray(json)) return json.flatMap(commandObjects);
  if (!isObject(json)) return [];
  const own = typeof json["command"] === "string" || typeof json["bash"] === "string" ? [json] : [];
  return [...own, ...Object.values(json).flatMap(commandObjects)];
}

/** Flat list of every `command` / `bash` string. */
export function commandsOf(json: Json): string[] {
  return commandObjects(json).flatMap((o) =>
    [o["command"], o["bash"]].filter((v): v is string => typeof v === "string"),
  );
}

export const usesNoUsageCaptureSh = (json: Json): boolean =>
  commandsOf(json).every((c) => !c.includes("usage-capture.sh"));

/** `node "<physical hooks>/<script>"`, the direct form both render paths write. */
export const nodeForm = (script: string, ...argv: string[]): string =>
  [`node "${path.join(HOOKS_REAL, script)}"`, ...argv].join(" ");

/** `value[key]` where value must be an object; undefined otherwise. */
export function at(value: Json | undefined, ...keys: (string | number)[]): Json | undefined {
  let cur: Json | undefined = value;
  for (const key of keys) {
    if (Array.isArray(cur) && typeof key === "number") cur = cur[key];
    else if (isObject(cur) && typeof key === "string") cur = cur[key];
    else return undefined;
  }
  return cur;
}

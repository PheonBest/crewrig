// antigravity-transcript-rig.ts — shared helpers of the Antigravity transcript suites
// (setup-transcript-antigravity-*.test.ts, mempalace-transcript-antigravity-payload.test.ts):
// and the shared path and label constants.

import fs from "node:fs";
import path from "node:path";

import { REPO, type Result } from "./worktree-fixtures.ts";

export const MANIFEST = path.join(REPO, "hooks", "antigravity-transcript-hooks.json");
export const GUARD_SCRIPT = path.join(REPO, "hooks", "worktree-git-guard.ts");
export const HOOK_SCRIPT = path.join(REPO, "hooks", "mempalace-transcript.sh");
export const OURS = "crewrig-mempalace-transcript";
export const GUARD = "crewrig-worktree-git-guard";

export type Json = Record<string, unknown>;

export const readJson = (file: string): Json => JSON.parse(fs.readFileSync(file, "utf8")) as Json;

/** Walk `keys` through nested objects and arrays; `undefined` when the path breaks. */
export const at = (value: unknown, ...keys: (string | number)[]): unknown =>
  keys.reduce<unknown>(
    (node, key) =>
      typeof node === "object" && node !== null
        ? (node as Record<string | number, unknown>)[key]
        : undefined,
    value,
  );

/** Every string under a `command` key, at any depth. */
export function commands(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(commands);
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) =>
    key === "command" && typeof child === "string" ? [child] : commands(child),
  );
}

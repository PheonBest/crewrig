// hook-map-probe.ts — the translator's side of the hook-map agreement check (spec 0259).
// Twin of the probe half of scripts/check-extension-hook-map.ts: one hook per event of the
// translator's closed set, rendered per target IN PROCESS (no temp directory, no jq), and the
// event keys the rendered file carries, in jq `keys` order (sorted).
//
// Reuses: scripts/lib/extension/hooks-vocab.ts (knownEvents, targetEvent), hooks-emit.ts
// (renderHookFile), descriptors.ts (readTargetTable, readJsonFile), types.ts (Target, JsonValue).

import { readJsonFile, readTargetTable } from "../extension/descriptors.ts";
import { renderHookFile } from "../extension/hooks-emit.ts";
import { knownEvents } from "../extension/hooks-vocab.ts";
import { jqText } from "../extension/json-write.ts";
import type { JsonValue, Target, TargetTable } from "../extension/types.ts";

/** The probe manifest: `{name, version, description, hooks: [{id, event, command}...]}`. */
export function probeManifest(): Map<string, JsonValue> {
  const hooks: JsonValue[] = knownEvents().map(
    (event) =>
      new Map<string, JsonValue>([
        ["id", `${event}-probe`],
        ["event", event],
        ["command", "echo hi"],
      ]),
  );
  return new Map<string, JsonValue>([
    ["name", "hook-map-probe"],
    ["version", "0.0.1"],
    ["description", "R6 agreement probe"],
    ["hooks", hooks],
  ]);
}

function sortedKeys(value: JsonValue | undefined): string[] {
  return value instanceof Map ? [...value.keys()].sort() : [];
}

export interface TargetProbe {
  /** `hookFile` of the descriptor row ("" when absent). */
  readonly hookFile: string;
  /** The event keys of the rendered hook file, one per line, "" when no file is produced. */
  readonly produced: string;
}

/** Render the probe for one target and list the event keys of its hook file. */
export function probeTarget(
  target: Target,
  manifest: Map<string, JsonValue>,
  table: TargetTable,
): TargetProbe {
  const hookFile = table[target].hookFile;
  const rendered = renderHookFile(target, manifest, table, process.platform);
  if (rendered === null || hookFile === "" || !(rendered.value instanceof Map)) {
    return { hookFile, produced: "" };
  }
  const root = rendered.value;
  if (target === "antigravity") {
    const first = sortedKeys(root)[0];
    return {
      hookFile,
      produced: sortedKeys(first === undefined ? undefined : root.get(first)).join("\n"),
    };
  }
  return { hookFile, produced: sortedKeys(root.get("hooks")).join("\n") };
}

/** `_ext_hooks_target_const <target> <field>` for a column the typed table does not carry. */
export function descriptorColumn(libDir: string, target: Target, field: string): string {
  const doc = readJsonFile(`${libDir}/extension-targets.json`);
  const row = doc instanceof Map ? doc.get(target) : undefined;
  const value = row instanceof Map ? row.get(field) : undefined;
  if (value === undefined || value === null || value === false) return "";
  return jqText(value);
}

export { readTargetTable };

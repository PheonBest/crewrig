// legacy.ts — recognition and rewrite of an installed `bash <repo>/scripts/lib/tls-exec.sh <command...>`
// command line (spec 0266 R9 and parent spec 0215 R15; slice 5b).
//
// The shell wrapper is gone, so no file backs the form any more: the recogniser is purely textual,
// as scripts/lib/hook-recognition.ts is for hooks. An entry is the legacy form when its command is
// `bash` and its first argument is an absolute path ending in `scripts/lib/tls-exec.sh`. The
// rewrite replaces those two words by the words of the current wrapper prefix and keeps every
// other word and field in place. Anything else (a user-edited line, another interpreter, a
// relative path) is not recognised and is never touched.
//
// Standard library and types only.

import type { JsonValue } from "../extension/types.ts";

/** The retired wrapper, relative to a checkout root. */
export const LEGACY_WRAPPER_TAIL = "scripts/lib/tls-exec.sh";
/** The wrapper entry, relative to a checkout root. */
export const WRAPPER_RELATIVE = "scripts/tls-exec.ts";

const ABSOLUTE = /^(?:\/|[A-Za-z]:[\\/])/;

/** True for an absolute path (either separator style) whose tail is `tail` after a separator. */
export function endsWithRelative(candidate: string, tail: string): boolean {
  if (!ABSOLUTE.test(candidate)) return false;
  const segments = candidate.split(/[\\/]+/);
  const wanted = tail.split("/");
  if (segments.length <= wanted.length) return false;
  return wanted.every((seg, i) => segments[segments.length - wanted.length + i] === seg);
}

/** True when `candidate` names the retired shell wrapper of some checkout. */
export function isLegacyWrapperPath(candidate: unknown): boolean {
  return typeof candidate === "string" && endsWithRelative(candidate, LEGACY_WRAPPER_TAIL);
}

/** True when `command` and `args` are `bash <path>/scripts/lib/tls-exec.sh ...`. */
export function isLegacyWrapperLine(command: unknown, args: unknown): boolean {
  return (
    command === "bash" &&
    Array.isArray(args) &&
    args.every((a) => typeof a === "string") &&
    isLegacyWrapperPath(args[0])
  );
}

/** The argv of a legacy line with the wrapper words replaced by `prefix`; `undefined` when not legacy. */
export function rewriteLegacyArgv(
  command: unknown,
  args: unknown,
  prefix: readonly string[],
): readonly string[] | undefined {
  if (!isLegacyWrapperLine(command, args)) return undefined;
  return [...prefix, ...(args as string[]).slice(1)];
}

/**
 * The entry (an MCP server object) with its legacy wrapper words replaced by `prefix`; key order and
 * every other field are kept. `undefined` when the entry is absent or not the legacy form.
 */
export function upgradeLegacyEntry(
  entry: JsonValue | undefined,
  prefix: readonly string[],
): Map<string, JsonValue> | undefined {
  if (!(entry instanceof Map)) return undefined;
  const words = rewriteLegacyArgv(entry.get("command"), entry.get("args"), prefix);
  if (words === undefined) return undefined;
  const out = new Map(entry);
  out.set("command", words[0] ?? "");
  out.set("args", words.slice(1));
  return out;
}

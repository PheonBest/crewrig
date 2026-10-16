// toml_merge.ts — TypeScript twin of toml_merge.sh: deep-merge a `local.toml` over a `defaults.toml`
// (ADR 0003 Decision 2; spec 0261 R6). Tables merge recursively, arrays append without
// de-duplication, scalars replace, `command` of a CLI is replaced as a whole by the local value,
// `env_keys` is de-duplicated first-seen. The result is JSON, two-space indented, key order kept,
// one trailing line feed. Input is read by `toml_subset.ts`, which refuses what the harness never
// uses (a refusal exits 1 with one diagnostic and no output; the shell's yq accepted most of it).

import fs from "node:fs";
import path from "node:path";

import { isNumber, isTable, parseToml, TomlError } from "./toml_subset.ts";
import type { TomlTable, TomlValue } from "./toml_subset.ts";

export interface MergeResult {
  readonly rc: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type JsonStyle = "yq" | "jq";

const SHORT: Record<string, string> = { "\n": "\\n", "\r": "\\r", "\t": "\\t" };

function jsonString(s: string, style: JsonStyle): string {
  let out = '"';
  for (const c of s) {
    const cp = c.codePointAt(0) ?? 0;
    if (c === '"') out += '\\"';
    else if (c === "\\") out += "\\\\";
    else if (SHORT[c] !== undefined) out += SHORT[c];
    else if (style === "jq" && c === "\b") out += "\\b";
    else if (style === "jq" && c === "\f") out += "\\f";
    else if (
      cp < 0x20 ||
      (style === "jq" && cp === 0x7f) ||
      (style === "yq" && (cp === 0x2028 || cp === 0x2029))
    )
      out += `\\u${cp.toString(16).padStart(4, "0")}`;
    else out += c;
  }
  return `${out}"`;
}

/** JSON text of a value, indented by two spaces per level (yq's and jq's layout). */
export function toJson(v: TomlValue, style: JsonStyle, depth = 0): string {
  if (typeof v === "string") return jsonString(v, style);
  if (typeof v === "boolean") return String(v);
  if (isNumber(v)) return v.num;
  const pad = "  ".repeat(depth + 1);
  const close = "  ".repeat(depth);
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    return `[\n${v.map((x) => pad + toJson(x, style, depth + 1)).join(",\n")}\n${close}]`;
  }
  if (v.size === 0) return "{}";
  const rows = [...v].map(
    ([k, x]) => `${pad}${jsonString(k, style)}: ${toJson(x, style, depth + 1)}`,
  );
  return `{\n${rows.join(",\n")}\n${close}}`;
}

/** `a *+ b` of yq: tables recurse, arrays append, anything else is replaced by `b`. */
export function mergeValues(a: TomlValue, b: TomlValue): TomlValue {
  if (isTable(a) && isTable(b)) {
    const out: TomlTable = new Map(a);
    for (const [k, v] of b) {
      const old = out.get(k);
      out.set(k, old === undefined ? v : mergeValues(old, v));
    }
    return out;
  }
  if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
  return b;
}

/** Phase 2 of the shell: `command` taken from local, `env_keys` de-duplicated first-seen. */
function fixups(merged: TomlTable, local: TomlTable): TomlTable | null {
  const cli = merged.get("cli");
  if (cli === undefined || !isTable(cli)) return null;
  const localCli = local.get("cli");
  for (const [name, entry] of cli) {
    if (!isTable(entry)) return null;
    const lc = localCli !== undefined && isTable(localCli) ? localCli.get(name) : undefined;
    const command = lc !== undefined && isTable(lc) ? lc.get("command") : undefined;
    if (command !== undefined && command !== false) entry.set("command", command);
    const keys = entry.get("env_keys");
    if (Array.isArray(keys)) {
      const seen = new Set<string>();
      entry.set(
        "env_keys",
        keys.filter((k) => {
          const id = toJson(k, "jq");
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        }),
      );
    }
  }
  return merged;
}

const isFile = (p: string) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

/** The script path the shell printed in its usage line (`$0`). */
const SCRIPT = path.join(import.meta.dirname, "toml_merge.sh");

function read(file: string, cwd: string): TomlTable | MergeResult {
  try {
    return parseToml(fs.readFileSync(path.resolve(cwd, file), "utf8"), file);
  } catch (e) {
    if (e instanceof TomlError) return { rc: 1, stdout: "", stderr: `ERROR: ${e.message}\n` };
    throw e;
  }
}

/** `toml_merge.sh <defaults.toml> [<local.toml>]`: argv without the program name. */
export function tomlMerge(
  args: readonly string[],
  cwd: string,
  env: Readonly<Record<string, string>>,
): MergeResult {
  if (args.length < 1 || args.length > 2) {
    return { rc: 2, stdout: "", stderr: `usage: ${SCRIPT} <defaults.toml> [<local.toml>]\n` };
  }
  const defaultsPath = args[0] ?? "";
  const localPath = args[1] ?? "";
  if (!isFile(path.resolve(cwd, defaultsPath))) {
    return { rc: 1, stdout: "", stderr: `ERROR: defaults file not found: ${defaultsPath}\n` };
  }
  const defaults = read(defaultsPath, cwd);
  if (!(defaults instanceof Map)) return defaults;
  if (localPath === "" || !isFile(path.resolve(cwd, localPath))) {
    return { rc: 0, stdout: `${toJson(defaults, "yq")}\n`, stderr: "" };
  }
  const local = read(localPath, cwd);
  if (!(local instanceof Map)) return local;
  const merged = mergeValues(defaults, local) as TomlTable;
  const lines = `${toJson(merged, "yq")}\n`.split("\n").length - 1;
  const fixed = fixups(merged, local);
  if (fixed === null) {
    const where = path.join(env.TMPDIR ?? "/tmp", "tmp.XXXXXXXXXX", "merged.json");
    return {
      rc: 5,
      stdout: "",
      stderr: `jq: error (at ${where}:${lines}): null (null) has no keys\n`,
    };
  }
  return { rc: 0, stdout: `${toJson(fixed, "jq")}\n`, stderr: "" };
}

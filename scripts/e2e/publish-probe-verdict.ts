// publish-probe-verdict.ts — TypeScript twin of publish-probe-verdict.sh (spec 0261 R1-R4, R24).
//
// Usage: node scripts/e2e/publish-probe-verdict.ts <report-dir> --issue <N> [--dry-run]
//
// Reads <report-dir>/verdict.json, renders a Markdown comment body to a file and posts it with
// `gh issue comment --body-file` (never `--body`). `--dry-run` prints the body and never calls gh.
// Deviation (a) of requirement 24: no jq is needed, so the "jq is required" diagnostic is gone.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { findOnPath, runTool } from "../../tests/e2e/lib/exec.ts";

const USAGE = `Usage: scripts/e2e/publish-probe-verdict.sh <report-dir> --issue <N> [--dry-run]

Reads <report-dir>/verdict.json and posts (or, with --dry-run, prints) the
rendered Markdown comment body for issue #<N>.
`;

type Json = unknown;
type Obj = Record<string, Json>;

/** A failure jq itself would report (exit status 5): the shell prints it and stops. */
export class JqError extends Error {
  readonly line: number;
  constructor(message: string, line: number) {
    super(message);
    this.line = line;
  }
}

/** `jq -r` on one value: a string verbatim, anything else as compact JSON (null and absent -> `null`). */
function jqRaw(v: Json): string {
  return typeof v === "string" ? v : (JSON.stringify(v ?? null) ?? "null");
}

/** `$(jq -r .x file)`: a string verbatim, anything else pretty-printed, trailing newlines stripped. */
function sub(v: Json): string {
  const raw = typeof v === "string" ? v : JSON.stringify(v ?? null, null, 2);
  return raw.replace(/\n+$/, "");
}

function isObj(v: Json): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function has(o: Obj, key: string): boolean {
  return Object.hasOwn(o, key);
}

function jqType(v: Json): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/** jq 1.7's truncated value dump in "Cannot iterate over": over 14 bytes, 11 bytes then `...` (no closing quote). */
function dump(v: Json): string {
  const d = JSON.stringify(v) ?? "null";
  if (Buffer.byteLength(d) <= 14) return d;
  return `${Buffer.from(d)
    .subarray(0, 11)
    .toString("utf8")
    .replace(/\uFFFD$/, "")}...`;
}

/** `.[]` : the elements of an array, the values of an object (in order), else jq's error. */
function iterate(v: Json, line: number): Json[] {
  if (Array.isArray(v)) return v;
  if (isObj(v)) return Object.values(v);
  throw new JqError(`Cannot iterate over ${jqType(v)} (${dump(v)})`, line);
}

function cellLine(c: Json, line: number): string {
  if (c !== null && !isObj(c)) {
    throw new JqError(`Cannot check whether ${jqType(c)} has a string key`, line);
  }
  const o: Obj = c ?? {};
  if (has(o, "cell")) {
    const r = o["reason"];
    const reason = r === null || r === undefined || r === false ? "" : jqRaw(r);
    return `- ${jqRaw(o["cell"])} (${jqRaw(o["cli"])}): **${jqRaw(o["outcome"])}** — ${reason}`;
  }
  return `- ${jqRaw(o["cli"])} / ${jqRaw(o["layout"])}: **${jqRaw(o["outcome"])}**`;
}

/** The line number jq reports: it has read the whole (one-chunk) file, so every newline counts. */
function jqLine(text: string): number {
  return text.split("\n").length - 1;
}

/** `(.contradicts // []) | length`, then `.contradicts[]` when positive. */
function contradictions(o: Obj, line: number): Json[] {
  const c = o["contradicts"];
  if (c === null || c === undefined || c === false) return [];
  if (c === true) throw new JqError("boolean (true) has no length", line);
  const n =
    typeof c === "number"
      ? Math.abs(c)
      : typeof c === "string"
        ? [...c].length
        : Array.isArray(c)
          ? c.length
          : Object.keys(c as Obj).length;
  return Number.isInteger(n) && n > 0 ? iterate(c, line) : [];
}

/** The Markdown body the shell builds into its temp file. Throws JqError where jq would fail. */
export function renderBody(text: string): string {
  const v = JSON.parse(text.replace(/^\uFEFF/, "")) as Json;
  const line = jqLine(text);
  if (v !== null && !isObj(v)) {
    throw new JqError(`Cannot index ${jqType(v)} with string "probe"`, line);
  }
  const o: Obj = v ?? {};
  let out = `## Probe verdict — \`${sub(o["probe"])}\`\n\n`;
  if (has(o, "verdict")) {
    out += `**Verdict:** \`${sub(o["verdict"])}\`  \n`;
    out += `**CLI:** ${sub(o["cli"])} (${sub(o["cli_version"])})  \n`;
  }
  if (has(o, "cells")) {
    out += "**Cells:**\n\n";
    for (const c of iterate(o["cells"], line)) out += `${cellLine(c, line)}\n`;
    out += "\n";
    const items = contradictions(o, line);
    if (items.length > 0) {
      out += "**Contradicts:**\n\n";
      for (const item of items) out += `- ${jqRaw(item)}\n`;
      out += "\n";
    }
  }
  out += `**Run:** \`${sub(o["run_id"])}\`, observed ${sub(o["observed_at"])}\n\n`;
  out += "<details><summary>verdict.json (verbatim)</summary>\n\n```json\n";
  out += `${JSON.stringify(v, null, 2)}\n`;
  out += "```\n\n</details>\n";
  return out;
}

function fail(message: string, code: number, withUsage = false): number {
  process.stderr.write(withUsage ? `${message}\n\n${USAGE}` : message);
  return code;
}

export function main(argv: readonly string[], env: Readonly<Record<string, string>>): number {
  let reportDir = "";
  let issue = "";
  let dryRun = false;
  for (let i = 0; i < argv.length;) {
    const a = argv[i] ?? "";
    if (a === "--issue") {
      if (i + 1 >= argv.length) return fail("ERROR: --issue requires a value.\n", 1);
      issue = argv[i + 1] ?? "";
      i += 2;
    } else if (a === "--dry-run") {
      dryRun = true;
      i += 1;
    } else if (a === "-h" || a === "--help") {
      process.stdout.write(USAGE);
      return 0;
    } else if (reportDir === "") {
      reportDir = a;
      i += 1;
    } else {
      return fail(`ERROR: unexpected argument: ${a}`, 2, true);
    }
  }
  if (reportDir === "") return fail("ERROR: missing <report-dir>.", 2, true);
  if (issue === "") return fail("ERROR: --issue <N> is required.", 2, true);

  const verdictJson = `${reportDir}/verdict.json`;
  let text: string;
  try {
    if (!fs.statSync(verdictJson).isFile()) throw new Error("not a file");
    text = fs.readFileSync(verdictJson, "utf8");
  } catch {
    return fail(`ERROR: no verdict.json at ${verdictJson}.\n`, 1);
  }
  let body: string;
  try {
    body = renderBody(text);
  } catch (e) {
    if (e instanceof JqError) {
      return fail(`jq: error (at ${verdictJson}:${e.line}): ${e.message}\n`, 5);
    }
    return fail(`ERROR: ${verdictJson} is not valid JSON.\n`, 2);
  }
  if (dryRun) {
    process.stdout.write(body);
    return 0;
  }
  if (findOnPath("gh", env) === null) {
    return fail("ERROR: gh (GitHub CLI) is required to publish (drop --dry-run to skip).\n", 1);
  }
  const suffix = crypto.randomBytes(6).toString("base64url").replace(/[-_]/g, "x").slice(0, 6);
  const bodyFile = path.join(os.tmpdir(), `crewrig-probe-verdict-body.${suffix}`);
  fs.writeFileSync(bodyFile, body, { flag: "wx", mode: 0o600 });
  try {
    const res = runTool("gh", ["issue", "comment", issue, "--body-file", bodyFile], {
      cwd: process.cwd(),
      env,
    });
    process.stdout.write(res.stdout);
    process.stderr.write(res.stderr);
    return res.rc;
  } finally {
    fs.rmSync(bodyFile, { force: true });
  }
}

function stringEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
  );
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename) {
  process.exitCode = main(process.argv.slice(2), stringEnv());
}

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

/** `jq -r` on one value: a string verbatim, anything else as compact JSON (null -> `null`). */
function jqRaw(v: Json): string {
  return typeof v === "string" ? v : JSON.stringify(v);
}

/** `$(jq -r .x file)`: a string verbatim, anything else pretty-printed, trailing newlines stripped. */
function sub(v: Json): string {
  const raw = typeof v === "string" ? v : JSON.stringify(v, null, 2);
  return raw.replace(/\n+$/, "");
}

function isObj(v: Json): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function has(o: Obj, key: string): boolean {
  return Object.hasOwn(o, key);
}

function cellLine(c: Json): string {
  if (!isObj(c)) return `- ${jqRaw(c)}`;
  const reason = c["reason"] === null || c["reason"] === false ? "" : jqRaw(c["reason"] ?? "");
  if (has(c, "cell")) {
    return `- ${jqRaw(c["cell"])} (${jqRaw(c["cli"])}): **${jqRaw(c["outcome"])}** — ${reason}`;
  }
  return `- ${jqRaw(c["cli"])} / ${jqRaw(c["layout"])}: **${jqRaw(c["outcome"])}**`;
}

/** The Markdown body the shell builds into its temp file. */
export function renderBody(text: string): string {
  const v = JSON.parse(text.replace(/^﻿/, "")) as Json;
  const o: Obj = isObj(v) ? v : {};
  let out = `## Probe verdict — \`${sub(o["probe"])}\`\n\n`;
  if (has(o, "verdict")) {
    out += `**Verdict:** \`${sub(o["verdict"])}\`  \n`;
    out += `**CLI:** ${sub(o["cli"])} (${sub(o["cli_version"])})  \n`;
  }
  if (has(o, "cells")) {
    out += "**Cells:**\n\n";
    const cells = o["cells"];
    const list = Array.isArray(cells) ? cells : isObj(cells) ? Object.values(cells) : [];
    for (const c of list) out += `${cellLine(c)}\n`;
    out += "\n";
    const contra = o["contradicts"];
    const items = Array.isArray(contra) ? contra : [];
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
  } catch {
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

// feedback-routing.ts — upstream-tier feedback-routing check (spec 0259; replaces the
// logic of scripts/check-feedback-routing.sh, spec 0030).
//
// Usage: checkFeedbackRouting({ yamlNamespace }) -> { code, stdout, stderr }
// Cwd-relative: the four tier roots are read relative to the working directory. Every
// line, FAIL lines included, goes to STDOUT. Sources are `find | sort` ordered: the whole
// printed path, by UTF-16 code unit (spec 0259 requirement 6), across all roots.
// Reused: scripts/lib/build-components/frontmatter.ts, scripts/lib/render-command.ts
// (frontmatterOfText), scripts/lib/yaml-text.ts, scripts/lib/governance/walk.ts.
// The file is read RAW (CRLF or BOM means no front matter, as awk saw it).
// Deviation (e): a front matter js-yaml refuses for a duplicated mapping key (yq accepted it)
// is reported, never skipped: `  FAIL <file> — duplicated mapping key in front matter` on
// stdout, listed in the FAILED block, exit 1.
// Exit codes: 0 all routed to canonical, 1 offenders, or the shell's silent `set -e`
// abort (a `provenance:` that is a sequence makes `yq .feedback` fail), or deviation (d):
// an unreadable source prints `Error: <path>: <reason>` on stderr and exits 1.
// Finding-line format: `  FAIL <file> — feedback '<f>' != canonical '<c>'`.
// Value rules as `yq -r '... // ""'`: null (any spelling), false and absent read empty;
// the literal text `null` skips like an empty value. A block-style collection value
// is rendered best-effort (never equal to canonical, so it is reported, not skipped).

import { lstatSync, readFileSync, statSync } from "node:fs";
import { createFrontmatter } from "../build-components/frontmatter.ts";
import { frontmatterOfText } from "../render-command.ts";
import type { YamlDoc } from "../yaml-text.ts";
import { fsReason, hasDuplicateKey } from "./metadata-keys.ts";
import type { Outcome } from "./metadata-keys.ts";
import { findFiles } from "./walk.ts";

const TIER_ROOTS = ["artifacts/core", "artifacts/library", "extensions/core", "extensions/library"];

/** `find -type f ( -name SKILL.md -o -name AGENT.md -o -path '*\/commands\/*.md' )`. */
function isSource(full: string): boolean {
  const base = full.slice(full.lastIndexOf("/") + 1);
  if (base === "SKILL.md" || base === "AGENT.md") return true;
  const at = full.indexOf("/commands/");
  return at >= 0 && full.length - 3 >= at + "/commands/".length && full.endsWith(".md");
}

function isRealDir(root: string): boolean {
  try {
    return statSync(root).isDirectory() && !lstatSync(root).isSymbolicLink();
  } catch {
    return false;
  }
}

function sources(): string[] {
  const all: string[] = [];
  for (const root of TIER_ROOTS) {
    if (!isRealDir(root)) continue;
    try {
      for (const rel of findFiles(root, (r) => isSource(`${root}/${r}`)))
        all.push(`${root}/${rel}`);
    } catch {
      // find discarded its own stderr and kept going.
    }
  }
  return all.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

type Read = { kind: "text"; value: string } | { kind: "abort" };

/** `.metadata.provenance.<key> // ""` as `yq -r` printed it; `abort` when yq fails. */
function provenanceValue(
  fm: ReturnType<typeof createFrontmatter>,
  doc: YamlDoc,
  key: string,
): Read {
  const core = doc.core as Record<string, Record<string, unknown>>;
  const prov = core["metadata"]?.["provenance"];
  if (Array.isArray(prov)) return { kind: "abort" };
  const value = fm.yaml.alt(doc, ["metadata", "provenance", key]);
  if (value !== "") return { kind: "text", value };
  const entry = fm.yaml.entries(doc, ["metadata", "provenance"]).find((e) => e.key === key);
  const raw = entry !== undefined && entry.kind !== "scalar" ? textOf(doc, key) : "";
  return { kind: "text", value: raw };
}

function textOf(doc: YamlDoc, key: string): string {
  const text = doc.text as Record<string, Record<string, Record<string, unknown>>>;
  const node = text["metadata"]?.["provenance"]?.[key];
  const lines = (n: unknown): string[] =>
    Array.isArray(n)
      ? n.flatMap((i) => [`- ${JSON.stringify(i)}`])
      : Object.entries(n as object).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  return node === null || node === undefined ? "" : lines(node).join("\n");
}

export function checkFeedbackRouting(input: { yamlNamespace: unknown }): Outcome {
  const fm = createFrontmatter(input.yamlNamespace);
  let stdout = "";
  let checked = 0;
  let skipped = 0;
  const failures: string[] = [];
  for (const file of sources()) {
    let doc: YamlDoc | null;
    try {
      const text = frontmatterOfText(readFileSync(file, "utf8"));
      doc = fm.yaml.parse(text);
      if (doc === null && hasDuplicateKey(input.yamlNamespace, text)) {
        stdout += `  FAIL ${file} — duplicated mapping key in front matter\n`;
        failures.push(file);
        continue;
      }
    } catch (err) {
      return { code: 1, stdout, stderr: `Error: ${file}: ${fsReason(err)}\n` };
    }
    if (doc === null || !fm.yaml.has(doc, ["metadata", "provenance"])) {
      skipped += 1;
      continue;
    }
    const feedback = provenanceValue(fm, doc, "feedback");
    if (feedback.kind === "abort") return { code: 1, stdout, stderr: "" };
    if (feedback.value === "" || feedback.value === "null") {
      skipped += 1;
      continue;
    }
    const canonical = provenanceValue(fm, doc, "canonical");
    if (canonical.kind === "abort") return { code: 1, stdout, stderr: "" };
    checked += 1;
    if (feedback.value === canonical.value) {
      stdout += `  OK   ${file}\n`;
    } else {
      stdout += `  FAIL ${file} — feedback '${feedback.value}' != canonical '${canonical.value}'\n`;
      failures.push(file);
    }
  }
  if (failures.length > 0) {
    stdout += `\nFAILED: ${failures.length} upstream-owned source(s) route feedback away from canonical:\n`;
    for (const f of failures) stdout += `  - ${f}\n`;
    stdout +=
      "\nPer spec 0030, every source under an upstream-owned tier\n" +
      "(artifacts/core, artifacts/library, extensions/core, extensions/library)\n" +
      "MUST declare metadata.provenance.feedback equal to\n" +
      'metadata.provenance.canonical (i.e. "${CANONICAL_REPO}"), so harness\n' +
      "feedback on upstream components always reaches upstream regardless of a\n" +
      'fork\'s feedback_repo. Replace "${FEEDBACK_REPO}" (or any divergent\n' +
      'literal) with "${CANONICAL_REPO}" in the offending source(s).\n';
    return { code: 1, stdout, stderr: "" };
  }
  stdout += `\nOK: ${checked} upstream-owned source(s) route feedback to canonical (${skipped} without a feedback declaration skipped).\n`;
  return { code: 0, stdout, stderr: "" };
}

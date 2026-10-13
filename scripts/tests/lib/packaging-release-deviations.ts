// packaging-release-deviations.ts — the TAGGED differences between the shell leg and the
// TypeScript leg of the entry-level differential proof (spec 0257 R24). Every difference found
// must match one rule here; an untagged one fails the test naming it. Tags (a)-(h) are the spec's
// deviation list; candidates found while writing the proof carry a descriptive tag.

import type { FileObs, Observed } from "./packaging-release-observe.ts";

export interface Difference {
  /** `status`, `stdout`, `stderr`, `file <rel>` or `archive-<part> <rel>`. */
  readonly field: string;
  readonly shell: string;
  readonly ts: string;
}

export interface Rule {
  readonly tag: string;
  readonly why: string;
  readonly matches: (diff: Difference) => boolean;
}

const firstLine = (text: string): string => text.split("\n")[0] ?? "";
const noQuotes = (text: string): string => text.replace(/['"`]/g, "");

export const RULES: readonly Rule[] = [
  {
    tag: "(a)",
    why: "archive bytes and the tar header fields (mtime, uid, uname, field widths) differ between GNU/bsd tar and the TypeScript writer; the decompressed ENTRIES are compared instead",
    matches: (d) => d.field.startsWith("archive-bytes ") || d.field.startsWith("archive-stream "),
  },
  {
    tag: "(c)",
    why: "the --check drift report: the shell prints a `diff -u` listing, the port bare -/+ lines; the Drift: line is common",
    matches: (d) =>
      d.field === "stderr" &&
      d.shell.startsWith("Drift:") &&
      firstLine(d.shell) === firstLine(d.ts),
  },
  {
    tag: "(d)",
    why: "`jq is required` / `tar is required`: the shell checks for the tools, the port needs neither",
    matches: (d) =>
      (d.field === "stdout" || d.field === "stderr") &&
      /(?:jq|tar) is required/.test(d.shell) &&
      !/(?:jq|tar) is required/.test(d.ts),
  },
  {
    tag: "(e)",
    why: "archive entries are ordered by byte value in the port, in directory order by the shell's tar",
    matches: (d) => d.field.startsWith("archive-order "),
  },
  {
    tag: "(h)",
    why: "quoting of a name inside a message differs; the words are equal",
    matches: (d) =>
      (d.field === "stdout" || d.field === "stderr") && noQuotes(d.shell) === noQuotes(d.ts),
  },
  {
    tag: "docs-usage-line",
    why: "the docs index usage line: `Usage: build-docs-index [--check]` against the shell's `$0`-based line",
    matches: (d) =>
      d.field === "stderr" &&
      d.shell.startsWith("Usage:") &&
      d.ts === "Usage: build-docs-index [--check]\n",
  },
  {
    tag: "docs-invalid-utf8",
    why: "an invalid UTF-8 page is decoded with U+FFFD by the port; the shell copies the bytes",
    matches: (d) =>
      d.field.startsWith("file ") &&
      d.ts.includes("\xef\xbf\xbd") &&
      !d.shell.includes("\xef\xbf\xbd"),
  },
];

function describeFile(obs: FileObs | undefined): string {
  if (obs === undefined) return "<absent>";
  if (obs.kind === "text") return obs.text;
  if (obs.kind === "binary") return `binary ${obs.sha256}`;
  return JSON.stringify(obs.entries);
}

/** Every difference between the shell and the TypeScript observation of one case. */
export function findDifferences(shell: Observed, ts: Observed): Difference[] {
  const out: Difference[] = [];
  const add = (field: string, a: string, b: string): void =>
    void (a === b || out.push({ field, shell: a, ts: b }));
  add("status", String(shell.status), String(ts.status));
  add("stdout", shell.stdout, ts.stdout);
  add("stderr", shell.stderr, ts.stderr);
  for (const rel of new Set([...Object.keys(shell.files), ...Object.keys(ts.files)])) {
    const a = shell.files[rel];
    const b = ts.files[rel];
    if (a?.kind === "archive" && b?.kind === "archive") {
      add(`archive-entries ${rel}`, describeFile(a), describeFile(b));
      add(`archive-order ${rel}`, a.order.join("\n"), b.order.join("\n"));
      add(`archive-stream ${rel}`, a.stream, b.stream);
      add(`archive-bytes ${rel}`, a.bytes, b.bytes);
    } else {
      add(`file ${rel}`, describeFile(a), describeFile(b));
    }
  }
  return out;
}

/** The tag of the rule a difference matches, or undefined when it is untagged. */
export function tagOf(diff: Difference): string | undefined {
  return RULES.find((rule) => rule.matches(diff))?.tag;
}

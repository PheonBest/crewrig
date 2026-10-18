// shell-scan.ts — proof that no shell entry point remains (spec 0266 R18, items 4a to 4c).

import { closeSync, openSync, readFileSync, readSync } from "node:fs";
import { basename, join } from "node:path";
import { classify, RULES } from "./classify.ts";
import type { Deps, Section } from "./types.ts";
import { table } from "./types.ts";

export interface Hit {
  file: string;
  line: number;
  kinds: string[];
  text: string;
  label: string;
  rule: string;
}

export interface ScanFacts {
  shellFiles: string[];
  allowlistEntries: number;
  hits: Hit[];
  unclassified: number;
}

const SHEBANG = /^#!\s*(?:\/usr\/bin\/env\s+(?:-S\s+)?)?(?:\S*\/)?(bash|sh|zsh|dash|ksh)\b/;

export function inScope(f: string): boolean {
  return (
    /^hooks\/[^/]+\.json$/.test(f) ||
    f === "Taskfile.yml" ||
    f.startsWith(".github/workflows/") ||
    f === ".gitlab-ci.yml" ||
    f.startsWith("ci/") ||
    f.startsWith("docs/") ||
    f === "README.md" ||
    f === "AGENTS.md" ||
    ["SKILL.md", "AGENT.md", "FORMAT.md"].includes(basename(f))
  );
}

/** Kinds of shell invocation words on a line: `bash ` / `sh ` word, `.sh` suffix. */
export function lineKinds(line: string): string[] {
  const kinds: string[] = [];
  if (/\b(?:bash|sh)[ \t]/.test(line)) kinds.push("bash/sh word");
  if (/\.sh\b/.test(line)) kinds.push(".sh");
  return kinds;
}

function firstBytes(path: string): string {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const buf = Buffer.alloc(160);
    const n = readSync(fd, buf, 0, 160, 0);
    return buf.subarray(0, n).toString("latin1").split("\n")[0] ?? "";
  } catch {
    return "";
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function scanShell({ root, run }: Deps): Section<ScanFacts> {
  const tracked = run("git", ["ls-files", "-z"], root)
    .stdout.split("\0")
    .filter((f) => f !== "");
  const byExt = tracked.filter((f) => f.endsWith(".sh"));
  const byShebang = tracked.filter(
    (f) => !f.endsWith(".sh") && SHEBANG.test(firstBytes(join(root, f))),
  );
  const shellFiles = [...byExt, ...byShebang].sort();

  const allow = join(root, "ci/shell-allowlist.txt");
  let allowlistEntries = -1;
  try {
    allowlistEntries = readFileSync(allow, "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "" && !l.startsWith("#")).length;
  } catch {
    allowlistEntries = -1;
  }

  const hits: Hit[] = [];
  for (const f of tracked.filter(inScope)) {
    let text: string;
    try {
      text = readFileSync(join(root, f), "utf8");
    } catch {
      continue;
    }
    text.split("\n").forEach((l, i) => {
      const kinds = lineKinds(l);
      if (kinds.length === 0) return;
      const c = classify(f, l);
      hits.push({
        file: f,
        line: i + 1,
        kinds,
        text: l.trim().slice(0, 140),
        label: c.label,
        rule: c.rule,
      });
    });
  }
  const unclassified = hits.filter((h) => h.label === "UNCLASSIFIED").length;
  const md = [
    "## 4. Proof that no shell entry point remains",
    "",
    "### 4a. Tracked shell files",
    "",
    `Evidence: \`git ls-files -z\` over ${tracked.length} tracked files; suffix \`.sh\` and a first line \`#!\` naming bash, sh, zsh, dash or ksh.`,
    "",
    `Counts: \`*.sh\` ${byExt.length}; shebang without the suffix ${byShebang.length}; total ${shellFiles.length}.`,
    "",
    shellFiles.length === 0
      ? "No tracked shell file."
      : shellFiles.map((f) => `- \`${f}\``).join("\n"),
    "",
    "### 4b. Allowlist",
    "",
    `\`ci/shell-allowlist.txt\` entries (non-blank, non-comment lines): ${allowlistEntries < 0 ? "FILE UNREADABLE" : allowlistEntries}.`,
    "",
    "### 4c. Shell-word scan of the invocation surfaces",
    "",
    "Scope: `hooks/*.json`, `Taskfile.yml`, `.github/workflows/*`, `.gitlab-ci.yml`, `ci/**`, `docs/**`, `README.md`, `AGENTS.md`, every `SKILL.md`, `AGENT.md` and `FORMAT.md` (tracked files, including built copies). Patterns: the word `bash` or `sh` followed by a space; the suffix `.sh`.",
    "",
    "Auto-classification rules (a hit no rule matches stays UNCLASSIFIED until a human classifies it):",
    "",
    ...RULES.map((r) => `- ${r.id}: ${r.describe}`),
    "",
    `Hits: ${hits.length}; historical (auto) ${hits.length - unclassified}; UNCLASSIFIED ${unclassified}.`,
    "",
    hits.length === 0
      ? "No hit."
      : table(
          ["file:line", "kind", "classification", "rule", "text"],
          hits.map((h) => [
            `${h.file}:${h.line}`,
            h.kinds.join(" + "),
            h.label,
            h.rule,
            `\`${h.text.replace(/`/g, "'")}\``,
          ]),
        ),
  ].join("\n");
  return { markdown: md, facts: { shellFiles, allowlistEntries, hits, unclassified } };
}

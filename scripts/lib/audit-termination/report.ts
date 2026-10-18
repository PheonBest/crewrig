// report.ts — assembles the R25 termination audit report (Markdown on stdout, never written to the repo).

import { checklist } from "./checklist.ts";
import { collectGaps } from "./gaps.ts";
import { collectIssues } from "./issues.ts";
import { rehearse } from "./rehearsal.ts";
import { scanShell } from "./shell-scan.ts";
import { collectSpecs } from "./specs.ts";
import type { Deps } from "./types.ts";

export interface AuditResult {
  markdown: string;
  /** Self-check failures (row 37g read as measured, rehearsal failure). */
  failures: string[];
}

export function buildReport(d: Deps, mergeRehearsal: boolean, now: Date = new Date()): AuditResult {
  const head = d.run("git", ["rev-parse", "HEAD"], d.root).stdout.trim();
  const specs = collectSpecs(d);
  const issues = collectIssues(d, specs.facts.rowTickets);
  const gaps = collectGaps(d);
  const scan = scanShell(d);
  const list = checklist(d, scan.facts, specs.facts);
  const reh = rehearse(d, { mergeRehearsal });
  const failures = [...gaps.facts.failures, ...reh.facts.failures];
  const md = [
    "# R25 termination audit of epic #1231 (DRAFT, generated)",
    "",
    `Generated ${now.toISOString()} by \`scripts/audit-termination.ts\` at HEAD \`${head}\`. Every figure below comes from a command run at audit time (command log at the end).`,
    "",
    `Self-check: ${failures.length === 0 ? "PASSED" : `FAILED (${failures.length})`}.`,
    "",
    specs.markdown,
    "",
    issues.markdown,
    "",
    gaps.markdown,
    "",
    scan.markdown,
    "",
    list.markdown,
    "",
    reh.markdown,
    "",
    "## Command log",
    "",
    ...commandLog(d),
  ].join("\n");
  return { markdown: md + "\n", failures };
}

function commandLog(d: Deps): string[] {
  return [
    "```text",
    ...d.lines().map((l) => (l.length > 300 ? `${l.slice(0, 300)}...` : l)),
    "```",
  ];
}

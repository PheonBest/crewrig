// checklist.ts — the termination checklist of parent requirement 25, one line per condition.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ScanFacts } from "./shell-scan.ts";
import type { SpecFacts } from "./specs.ts";
import type { Deps, Section, Verdict } from "./types.ts";
import { table } from "./types.ts";

/** Job ids and names mentioning windows in `.github/workflows/build.yml`, plus runs-on windows jobs. */
export function windowsJobs(yaml: string): string[] {
  const jobs: string[] = [];
  let job = "";
  let inJobs = false;
  let named = false;
  for (const l of yaml.split("\n")) {
    if (/^jobs:\s*$/.test(l)) inJobs = true;
    else if (/^\S/.test(l)) inJobs = false;
    if (!inJobs) continue;
    const j = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(l);
    if (j?.[1] !== undefined) {
      job = j[1];
      named = false;
      if (/windows/i.test(job)) jobs.push(job);
      continue;
    }
    const nm = /^ {4}name:\s*(.+?)\s*$/.exec(l);
    if (nm?.[1] !== undefined && /windows/i.test(nm[1]) && !/windows/i.test(job)) {
      jobs.push(`${job} (name: ${nm[1]})`);
      named = true;
    }
    if (/^ {4}runs-on:\s*.*windows/i.test(l) && !/windows/i.test(job) && !named)
      jobs.push(`${job} (runs-on windows)`);
  }
  return jobs;
}

export function checklist(
  d: Deps,
  scan: ScanFacts,
  specs: SpecFacts,
): Section<{ rows: [string, Verdict, string][] }> {
  const rows: [string, Verdict, string][] = [];
  rows.push([
    "Ratchet allowlist is empty",
    scan.allowlistEntries === 0 ? "MET" : "NOT MET",
    `\`ci/shell-allowlist.txt\` has ${scan.allowlistEntries} entries (4b).`,
  ]);
  rows.push([
    "No tracked shell script exists",
    scan.shellFiles.length === 0 ? "MET" : "NOT MET",
    `${scan.shellFiles.length} tracked files match \`*.sh\` or a shell shebang (4a).`,
  ]);
  rows.push([
    "No hook, CLI integration point, Taskfile task, workflow step, doc page or skill invokes a shell script",
    scan.unclassified === 0 ? "MET" : "NEEDS-MANUAL-EVIDENCE",
    scan.unclassified === 0
      ? `all ${scan.hits.length} hits of 4c carry an auto-classification rule; a reviewer still reads the rule set.`
      : `${scan.unclassified} of ${scan.hits.length} hits of 4c are UNCLASSIFIED; a human classifies each as historical or live.`,
  ]);
  rows.push([
    "Every sub-spec carries `status: implemented`",
    specs.notImplemented.length === 0 && specs.missing.length === 0 ? "MET" : "NOT MET",
    specs.notImplemented.length === 0
      ? `all ${specs.rows.length} specs of section 1 are implemented.`
      : `not implemented: ${specs.notImplemented.map((r) => `${r.id}=${r.status}`).join(", ")}.`,
  ]);
  let jobs: string[] = [];
  try {
    jobs = windowsJobs(readFileSync(join(d.root, ".github/workflows/build.yml"), "utf8"));
  } catch {
    jobs = [];
  }
  rows.push([
    "Every migrated user-facing entry point has a green `windows-latest` job",
    "NEEDS-MANUAL-EVIDENCE",
    `${jobs.length} windows jobs in \`.github/workflows/build.yml\`: ${jobs.join(", ") || "none"}. Verify on the release head run; this tool does not claim green.`,
  ]);
  const md = [
    "## 5. Termination checklist (parent requirement 25)",
    "",
    table(
      ["condition", "verdict", "evidence"],
      rows.map((r) => [...r]),
    ),
  ].join("\n");
  return { markdown: md, facts: { rows } };
}

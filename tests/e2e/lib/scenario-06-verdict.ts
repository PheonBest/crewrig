// scenario-06-verdict.ts — the verdict.json and the TAP subplan of scenarios/06-agent-surface-consumption
// (spec 0194 probe B), twin of the `jq` blocks of run.sh (spec 0261). Change both, and keep them equal.

import fs from "node:fs";
import path from "node:path";

export interface CellRecord {
  readonly cli: string;
  readonly cli_version: string;
  readonly surface: string;
  readonly layout: string;
  readonly path: string;
  readonly outcome: string;
  readonly observable: {
    readonly nonce_observed: boolean;
    readonly baseline_observed: boolean;
    readonly spawn_observed: boolean;
    readonly subagent_responded: boolean;
    readonly legacy_nonce_observed: boolean;
    readonly evidence: string;
  };
  readonly control: string;
  readonly role: string;
  readonly observed_at: string;
}

const CONTRADICTS: readonly string[] = [
  'specs/0143-copilot-subagent-model-fallback.md -> ## Intent ("Copilot CLI inspects .claude/agents")',
  "specs/0143-copilot-subagent-model-fallback.md delta-01 -> shared-read hazard section (pull request 1102)",
  "epic #1100 -> compiled-layout-convention block",
];

/** `date -u +%Y-%m-%dT%H:%M:%SZ`. */
export function utcStamp(now: Date): string {
  return `${now.toISOString().slice(0, 19)}Z`;
}

/** `jq` prints DEL as \u007f where JSON.stringify leaves it raw. */
function jqJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2).replaceAll("\u007f", "\\u007f")}\n`;
}

export function writeVerdict(
  reportDir: string,
  runId: string,
  now: Date,
  cells: readonly CellRecord[],
  copilotNestedOutcome: string,
): void {
  const contradicts = copilotNestedOutcome === "not-consumed" ? CONTRADICTS : [];
  const crossRef =
    copilotNestedOutcome === ""
      ? null
      : {
          comment_url: "https://github.com/crewrig/crewrig/issues/1103#issuecomment-5506957758",
          probe_a_verdict: "INDETERMINATE",
          probe_b_copilot_nested_reading: copilotNestedOutcome,
          note: "probe A did not discriminate (session never established); no agreement/disagreement to report yet",
        };
  const verdict = {
    probe: "06-agent-surface-consumption",
    spec: "0194",
    run_id: runId,
    observed_at: utcStamp(now),
    cells,
    contradicts,
    probe_a_cross_reference: crossRef,
  };
  fs.writeFileSync(path.join(reportDir, "verdict.json"), jqJson(verdict));
}

/** One `ok N - cli/layout: outcome` per cell, then the plan line. */
export function writeSubplan(reportDir: string, cells: readonly CellRecord[]): void {
  let text = "";
  cells.forEach((c, i) => {
    text += `ok ${i + 1} - ${c.cli}/${c.layout}: ${c.outcome}\n`;
  });
  text += `1..${cells.length}\n`;
  fs.writeFileSync(path.join(reportDir, "scenario.tap"), text);
}

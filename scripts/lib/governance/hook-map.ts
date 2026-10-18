// hook-map.ts — the R6 agreement check between docs/extension-hook-events.md and the
// translator (spec 0179, spec 0259). Twin of scripts/check-extension-hook-map.ts: three
// finding families, in the shell's order, each line byte for byte.
//   1. every event of the translator's closed set has a table row that agrees with the
//      translator's mapping and with the event keys its rendered probe carries;
//   2. every row of the "## Correspondence table" section names a known event;
//   3. each target's section header cells (hook file, time unit, root token) agree with
//      scripts/lib/extension-targets.json.
//
// Reuses: scripts/lib/extension/hooks-vocab.ts (knownEvents, targetEvent), the probe
// module hook-map-probe.ts (hooks-emit.ts, descriptors.ts).

import { knownEvents, targetEvent } from "../extension/hooks-vocab.ts";
import type { Target } from "../extension/types.ts";
import { descriptorColumn, probeManifest, probeTarget, readTargetTable } from "./hook-map-probe.ts";

const TARGET_LIST: readonly Target[] = ["claude", "gemini", "copilot", "antigravity"];
const TABLE_COLUMN: Readonly<Record<Target, number>> = {
  claude: 2,
  gemini: 3,
  copilot: 4,
  antigravity: 5,
};
const SECTION_HEADER: Readonly<Record<Target, string>> = {
  claude: "### Claude Code",
  gemini: "### Gemini CLI",
  copilot: "### GitHub Copilot CLI",
  antigravity: "### Antigravity CLI",
};

/** The lines of a text file as grep and awk see them (a final line feed ends no extra line). */
export function textLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** `table_row_line`: the first line holding "| `<event>` |" anywhere. */
function rowLine(lines: readonly string[], event: string): string {
  const needle = `| \`${event}\` |`;
  return lines.find((l) => l.includes(needle)) ?? "";
}

/** `table_cell`: column of the row, spaces trimmed, backticks removed. */
function tableCell(line: string, target: Target): string {
  const field = line.split("|")[TABLE_COLUMN[target]] ?? "";
  return field.replace(/^ +| +$/g, "").replaceAll("`", "");
}

/** The lines of a `##`/`###` section: after the exact header, up to the next stop line. */
function section(lines: readonly string[], header: string, stop: RegExp): string[] {
  const out: string[] = [];
  let found = false;
  for (const l of lines) {
    if (l === header) {
      found = true;
      continue;
    }
    if (found && stop.test(l)) break;
    if (found) out.push(l);
  }
  return out;
}

/** `grep -m1 <marker>` then a `sed -n s///p` capture: "" when either does not match. */
function captured(lines: readonly string[], marker: string, re: RegExp): string {
  const line = lines.find((l) => l.includes(marker));
  return line === undefined ? "" : (re.exec(line)?.[1] ?? "");
}

export interface HookMapResult {
  readonly out: string[];
  readonly code: number;
}

/** Run the whole check; `doc` is the doc path printed in findings, `libDir` the descriptor dir. */
export function checkHookMap(docText: string, doc: string, libDir: string): HookMapResult {
  const lines = textLines(docText);
  const out: string[] = [];
  let failures = 0;
  const fail = (line: string): void => {
    out.push(line);
    failures += 1;
  };
  const table = readTargetTable(libDir);
  const manifest = probeManifest();
  const probes = new Map(TARGET_LIST.map((t) => [t, probeTarget(t, manifest, table)] as const));

  for (const event of knownEvents()) {
    const row = rowLine(lines, event);
    if (row === "") {
      fail(
        `  FAIL ${doc} — no row for neutral event '${event}', which is in the translator's closed set (scripts/lib/extension-hooks.sh)`,
      );
      continue;
    }
    for (const target of TARGET_LIST) {
      const produced = probes.get(target)?.produced ?? "";
      const cell = tableCell(row, target);
      const actual = targetEvent(event, target);
      if (cell === "" || cell === "**no counterpart**" || cell === "no counterpart") {
        if (actual !== "") {
          fail(
            `  FAIL ${doc} — table cell (event '${event}', target '${target}') says no counterpart, but the translator DOES produce '${actual}'`,
          );
        }
        continue;
      }
      if (cell !== actual) {
        fail(
          `  FAIL disagreement (event '${event}', target '${target}') — table says '${cell}', translator's mapping function says '${actual}'`,
        );
        continue;
      }
      if (!produced.split("\n").includes(cell)) {
        fail(
          `  FAIL disagreement (event '${event}', target '${target}') — table and translator mapping both say '${cell}', but the RENDERED output does not carry that event key (produced: ${produced === "" ? "<none>" : produced})`,
        );
      }
    }
  }

  const known = knownEvents();
  for (const line of section(lines, "## Correspondence table", /^## /)) {
    if (!line.startsWith("| `")) continue;
    const rowEvent = /^\| `([^`]*)` \|/.exec(line)?.[1] ?? "";
    if (rowEvent === "" || known.includes(rowEvent)) continue;
    fail(
      `  FAIL ${doc} — row names event '${rowEvent}', which the translator does not recognize (scripts/lib/extension-hooks.sh)`,
    );
  }

  for (const target of TARGET_LIST) {
    const body = section(lines, SECTION_HEADER[target], /^### /);
    const checks: ReadonlyArray<readonly [string, string, string, RegExp]> = [
      ["hook file", "**Hook file:**", "hookFile", /^[^`]*`([^`]*)`/s],
      ["time unit", "**Time unit:**", "timeUnit", /^.*\*\*Time unit:\*\* ([a-z]*)/s],
      ["extension-root form", "**Extension-root form:**", "rootToken", /^[^`]*`([^`]*)`/s],
    ];
    for (const [label, marker, field, re] of checks) {
      const docValue = captured(body, marker, re);
      const descValue = descriptorColumn(libDir, target, field);
      if (docValue !== descValue) {
        fail(
          `  FAIL reconciliation (${target}) — docs/extension-hook-events.md ${label} is '${docValue}', scripts/lib/extension-targets.json ${field} is '${descValue}'`,
        );
      }
    }
  }

  if (failures > 0) {
    out.push("");
    out.push(
      `FAILED: ${failures} disagreement(s) between docs/extension-hook-events.md and scripts/lib/extension-hooks.sh / scripts/lib/extension-targets.json.`,
    );
    return { out, code: 1 };
  }
  out.push(
    "OK: docs/extension-hook-events.md agrees with the translator's actual output and with scripts/lib/extension-targets.json.",
  );
  return { out, code: 0 };
}

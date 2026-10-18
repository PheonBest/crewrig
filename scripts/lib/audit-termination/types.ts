// types.ts — shared shapes of the R25 termination audit tool (spec 0266 R19).

export interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

/** Runs `git` or `gh` and returns its result; the only process boundary of the tool. */
export type Run = (cmd: "git" | "gh", args: readonly string[], cwd?: string) => RunResult;

export interface Deps {
  /** Repository root being audited (read-only). */
  root: string;
  run: Run;
  /** Appends one line to the command log printed at the end of the report. */
  log: (line: string) => void;
  /** Every line logged so far, for the report's command log. */
  lines: () => readonly string[];
  /** Directory under which the rehearsal clone is created (default: the OS temp dir). */
  tmpBase: string;
}

export type Verdict = "MET" | "NOT MET" | "NEEDS-MANUAL-EVIDENCE";

/** A report section: Markdown text plus the facts later sections or the checklist consume. */
export interface Section<T> {
  markdown: string;
  facts: T;
}

export const REPO = "crewrig/crewrig";
export const EPIC = 1231;
export const ROW_TICKET = 1344;

/** Escape a cell for a Markdown table. */
export function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const lines = [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`];
  for (const r of rows) lines.push(`| ${r.map(cell).join(" | ")} |`);
  return lines.join("\n");
}

/** A log buffer: `log` appends, `lines` reads. */
export function makeLog(): Pick<Deps, "log" | "lines"> {
  const buf: string[] = [];
  return { log: (l) => void buf.push(l), lines: () => buf };
}

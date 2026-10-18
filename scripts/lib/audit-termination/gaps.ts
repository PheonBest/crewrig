// gaps.ts — accepted gaps: docs/cli-matrix.md rows 37g and 42, and #1601 / #1693 (spec 0266 R19, R22).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Deps, Section } from "./types.ts";
import { REPO, table } from "./types.ts";

export interface GapFacts {
  /** Self-check failures; a non-empty list makes the tool exit non-zero. */
  failures: string[];
  /** Row 42 cells that are NOT MEASURED (count of four). */
  row42NotMeasured: number;
}

const CLIS = ["Claude Code", "Gemini CLI", "Copilot CLI", "Antigravity CLI"];

/** Cells of the matrix row whose first cell is `id`: [id, feature, source, ...four CLI cells]. */
export function matrixRow(text: string, id: string): string[] | undefined {
  for (const line of text.split("\n")) {
    if (!line.startsWith(`| ${id} | `)) continue;
    return line
      .replace(/^\|\s*/, "")
      .replace(/\s*\|\s*$/, "")
      .split(" | ");
  }
  return undefined;
}

const notMeasured = (c: string): boolean => /NOT MEASURED/i.test(c);

function ownerOf(d: Deps, n: number): { state: string; owner: string; title: string } {
  const r = d.run("gh", ["api", `repos/${REPO}/issues/${n}`]);
  try {
    const j = JSON.parse(r.stdout) as {
      state: string;
      title: string;
      assignees?: { login: string }[];
    };
    const owner = (j.assignees ?? []).map((a) => `@${a.login}`).join(", ");
    return {
      state: j.state.toLowerCase(),
      owner: owner === "" ? "(none assigned on the forge)" : owner,
      title: j.title,
    };
  } catch {
    return { state: "unknown", owner: "(unresolved)", title: "" };
  }
}

export function collectGaps(d: Deps): Section<GapFacts> {
  const failures: string[] = [];
  const matrix = readFileSync(join(d.root, "docs/cli-matrix.md"), "utf8");
  const r37 = matrixRow(matrix, "37g");
  const r42 = matrixRow(matrix, "42");
  const out: string[] = ["## 3. Accepted gaps", ""];
  out.push(
    "### Gap A: #1601, Windows plugin-root hook measurement (`docs/cli-matrix.md` row 37g)",
    "",
  );
  if (r37 === undefined || r37.length < 7) {
    failures.push("row 37g not found or malformed in docs/cli-matrix.md");
    out.push("Row 37g NOT FOUND or malformed: SELF-CHECK FAILED.");
  } else {
    const cells = r37.slice(-4);
    out.push(
      table(
        ["CLI", "cell, verbatim"],
        cells.map((c, i) => [CLIS[i] ?? `cell ${i}`, c]),
      ),
      "",
    );
    cells.forEach((c, i) => {
      if (!notMeasured(c))
        failures.push(`row 37g ${CLIS[i]} cell does not read NOT MEASURED (nobody measured it)`);
    });
    const i1601 = ownerOf(d, 1601);
    out.push(
      `Evidence: the four cells above, copied from the file at audit time. Owner: the maintainer with a Windows machine (spec 0266 R19); forge assignee: ${i1601.owner}. Issue: #1601 (${i1601.state}${i1601.title === "" ? "" : `, ${i1601.title}`}).`,
    );
  }
  out.push("", "### Gap B: `docs/cli-matrix.md` row 42, missing-hook behaviour", "");
  let row42NotMeasured = 0;
  if (r42 === undefined || r42.length < 7) {
    failures.push("row 42 not found or malformed in docs/cli-matrix.md");
    out.push("Row 42 NOT FOUND or malformed: SELF-CHECK FAILED.");
  } else {
    const cells = r42.slice(-4);
    row42NotMeasured = cells.filter(notMeasured).length;
    out.push(
      table(
        ["CLI", "cell, verbatim", "NOT MEASURED"],
        cells.map((c, i) => [CLIS[i] ?? `cell ${i}`, c, notMeasured(c) ? "yes" : "no"]),
      ),
      "",
      `Evidence: ${row42NotMeasured} of 4 cells read NOT MEASURED. Owner: not assigned in the repository (the cells say "follow-up to be opened by the coordinator"; no owner is invented here). Issue: none cited in the row.`,
    );
  }
  out.push("", "### Gap C: #1693", "");
  const g = ownerOf(d, 1693);
  out.push(
    g.state === "open"
      ? `#1693 is open: ${g.title}. Owner (forge assignee): ${g.owner}. Evidence: \`gh api repos/${REPO}/issues/1693\` at audit time.`
      : `#1693 state at audit time: ${g.state}${g.title === "" ? "" : ` (${g.title})`}; listed only if open. Evidence: \`gh api repos/${REPO}/issues/1693\`.`,
  );
  out.push(
    "",
    failures.length === 0
      ? "Self-check: PASSED (no row 37g cell reads measured)."
      : `Self-check: FAILED: ${failures.join("; ")}.`,
  );
  return { markdown: out.join("\n"), facts: { failures, row42NotMeasured } };
}

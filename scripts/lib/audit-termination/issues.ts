// issues.ts — follow-up issues of the epic and their state (spec 0266 R19, second item).

import type { Deps, Section } from "./types.ts";
import { EPIC, REPO, ROW_TICKET, table } from "./types.ts";

export interface IssueRow {
  number: number;
  title: string;
  state: string;
  owner: string;
  origin: string[];
  isPr: boolean;
}

export interface IssueFacts {
  rows: IssueRow[];
  open: IssueRow[];
}

interface ViewJson {
  body?: string;
  comments?: { body?: string }[];
}

interface ApiIssue {
  number: number;
  title: string;
  state: string;
  assignees?: { login: string }[];
  pull_request?: unknown;
}

/** `#N` references of a text, as numbers. */
export function refsOf(text: string): number[] {
  return [...text.matchAll(/(?:^|[^\w&/])#(\d{1,6})\b/g)].map((m) => Number(m[1]));
}

function viewTexts(d: Deps, n: number): string[] {
  const r = d.run("gh", ["issue", "view", String(n), "--repo", REPO, "--json", "body,comments"]);
  try {
    const j = JSON.parse(r.stdout) as ViewJson;
    return [j.body ?? "", ...(j.comments ?? []).map((c) => c.body ?? "")];
  } catch {
    d.log(`gh issue view ${n}: unparseable output (status ${r.status})`);
    return [];
  }
}

export function collectIssues(d: Deps, rowTickets: ReadonlySet<number>): Section<IssueFacts> {
  const origin = new Map<number, Set<string>>();
  const add = (n: number, why: string): void => {
    if (!origin.has(n)) origin.set(n, new Set());
    origin.get(n)?.add(why);
  };
  const excluded = new Set<number>([EPIC, ROW_TICKET, ...rowTickets]);
  for (const src of [EPIC, ROW_TICKET]) {
    for (const t of viewTexts(d, src))
      for (const n of refsOf(t)) if (!excluded.has(n)) add(n, `#${src} reference`);
  }
  const search = d.run("gh", [
    "issue",
    "list",
    "--repo",
    REPO,
    "--search",
    `${EPIC} in:body`,
    "--state",
    "all",
    "--limit",
    "200",
    "--json",
    "number,title,state,assignees",
  ]);
  try {
    for (const i of JSON.parse(search.stdout) as { number: number }[])
      if (!excluded.has(i.number)) add(i.number, `search "${EPIC} in:body"`);
  } catch {
    d.log(`gh issue list: unparseable output (status ${search.status})`);
  }
  const rows: IssueRow[] = [];
  for (const n of [...origin.keys()].sort((a, b) => a - b)) {
    const r = d.run("gh", ["api", `repos/${REPO}/issues/${n}`]);
    let j: ApiIssue | undefined;
    try {
      j = JSON.parse(r.stdout) as ApiIssue;
    } catch {
      j = undefined;
    }
    const why = [...(origin.get(n) ?? [])];
    if (j === undefined || typeof j.number !== "number") {
      rows.push({
        number: n,
        title: "(unresolved by gh api)",
        state: "unknown",
        owner: "",
        origin: why,
        isPr: false,
      });
      continue;
    }
    const owner = (j.assignees ?? []).map((a) => `@${a.login}`).join(", ");
    rows.push({
      number: n,
      title: j.title,
      state: j.state.toLowerCase(),
      owner,
      origin: why,
      isPr: j.pull_request !== undefined,
    });
  }
  const issues = rows.filter((r) => !r.isPr);
  const open = issues.filter((r) => r.state === "open");
  const md = [
    "## 2. Follow-up issues",
    "",
    `Evidence: \`#N\` references in the bodies and comments of #${EPIC} and #${ROW_TICKET} (row tickets, #${EPIC} and #${ROW_TICKET} excluded), \`gh issue list --search "${EPIC} in:body" --state all\`, one \`gh api repos/${REPO}/issues/N\` per candidate. Pull requests are listed apart.`,
    "",
    `Issues: ${issues.length} (open ${open.length}, closed ${issues.filter((r) => r.state === "closed").length}, other ${issues.filter((r) => r.state !== "open" && r.state !== "closed").length}); pull requests referenced: ${rows.length - issues.length}.`,
    "",
    table(
      ["issue", "title", "state", "owner (assignee)", "found by"],
      issues.map((r) => [
        `#${r.number}`,
        r.title,
        r.state,
        r.owner === "" ? "(none assigned)" : r.owner,
        r.origin.join("; "),
      ]),
    ),
    "",
    "### Open follow-ups (accepted-gap candidates)",
    "",
    open.length === 0
      ? "None."
      : table(
          ["issue", "title", "owner (assignee)"],
          open.map((r) => [`#${r.number}`, r.title, r.owner === "" ? "(none assigned)" : r.owner]),
        ),
    "",
    `Pull requests referenced (not follow-ups): ${
      rows
        .filter((r) => r.isPr)
        .map((r) => `#${r.number}`)
        .join(", ") || "none"
    }.`,
  ].join("\n");
  return { markdown: md, facts: { rows: issues, open } };
}

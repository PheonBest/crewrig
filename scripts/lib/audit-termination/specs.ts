// specs.ts — every spec of the epic with its status (spec 0266 R19, first item).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "../spec-status-derivation.ts";
import type { Deps, Section } from "./types.ts";
import { EPIC, REPO, table } from "./types.ts";

export interface SpecRow {
  file: string;
  id: string;
  status: string;
  version: string;
  issue: string;
  sources: string[];
}

export interface SpecFacts {
  rows: SpecRow[];
  notImplemented: SpecRow[];
  /** Spec paths named by the epic body that are not tracked. */
  missing: string[];
  /** Row-ticket numbers (related-issue of the epic's specs). */
  rowTickets: Set<number>;
  epicBody: string;
}

const PARENT = "specs/0215-shell-to-typescript-migration.md";
const SPEC_FILE = /^specs\/\d{4}-[^/]+\.md$/;

function firstLines(text: string, n: number): string {
  return text.split("\n").slice(0, n).join("\n");
}

/** Spec paths named on table lines of the epic body (`specs/NNNN-slug.md`, or `spec NNNN`). */
export function epicTableSpecs(body: string, tracked: readonly string[]): string[] {
  const found = new Set<string>();
  for (const line of body.split("\n")) {
    if (!line.includes("|")) continue;
    for (const m of line.matchAll(/specs\/(\d{4}-[A-Za-z0-9._-]+?\.md)/g))
      found.add(`specs/${m[1]}`);
    for (const m of line.matchAll(/spec(?:s)?\s+`?(\d{4})`?/gi)) {
      for (const f of tracked)
        if (f.startsWith(`specs/${m[1]}-`) && !f.includes(".delta-")) found.add(f);
    }
  }
  return [...found];
}

export function collectSpecs({ root, run, log }: Deps): Section<SpecFacts> {
  const tracked = run("git", ["ls-files", "specs"], root)
    .stdout.split("\n")
    .filter((f) => SPEC_FILE.test(f));
  const view = run("gh", ["issue", "view", String(EPIC), "--repo", REPO, "--json", "body"]);
  let epicBody = "";
  try {
    epicBody = (JSON.parse(view.stdout) as { body?: string }).body ?? "";
  } catch {
    log(`gh issue view ${EPIC}: unparseable output (status ${view.status})`);
  }
  const bySource = new Map<string, Set<string>>();
  const add = (f: string, why: string): void => {
    if (!bySource.has(f)) bySource.set(f, new Set());
    bySource.get(f)?.add(why);
  };
  for (const f of tracked) {
    if (f.startsWith("specs/0215-")) add(f, "0215 or delta");
    else if (firstLines(readFileSync(join(root, f), "utf8"), 60).includes(PARENT))
      add(f, "cites parent");
  }
  const named = epicTableSpecs(epicBody, tracked);
  const missing: string[] = [];
  for (const f of named) {
    if (tracked.includes(f)) add(f, "epic table");
    else missing.push(f);
  }
  const rows: SpecRow[] = [...bySource.keys()].sort().map((file) => {
    const fm = parseFrontmatter(readFileSync(join(root, file), "utf8"));
    return {
      file,
      id: fm.id ?? "?",
      status: fm.status ?? "?",
      version: fm.version ?? "?",
      issue: fm["related-issue"] ?? "?",
      sources: [...(bySource.get(file) ?? [])],
    };
  });
  const notImplemented = rows.filter((r) => r.status !== "implemented");
  const rowTickets = new Set<number>();
  for (const r of rows) if (/^\d+$/.test(r.issue)) rowTickets.add(Number(r.issue));
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  const md = [
    "## 1. Specs of the epic",
    "",
    `Evidence: \`git ls-files specs\`, the first 60 lines of each spec, \`gh issue view ${EPIC} --repo ${REPO} --json body\` (cross-check only).`,
    "",
    `Totals by status: ${[...counts].map(([s, n]) => `${s}=${n}`).join(", ")} (${rows.length} specs).`,
    "",
    table(
      ["id", "file", "status", "version", "related issue", "found by", "flag"],
      rows.map((r) => [
        r.id,
        r.file,
        r.status,
        r.version,
        `#${r.issue}`,
        r.sources.join("; "),
        r.status === "implemented" ? "" : "NOT IMPLEMENTED",
      ]),
    ),
    "",
    missing.length === 0
      ? "Spec paths named in the epic body table but not tracked: none."
      : `Spec paths named in the epic body table but not tracked: ${missing.join(", ")}.`,
  ].join("\n");
  return { markdown: md, facts: { rows, notImplemented, missing, rowTickets, epicBody } };
}

// usage-dashboard-text.ts — form C of cases 13.1/13.2: the text report's rows parse back to the view model
// and a `note:` line follows every price row (ported from the Bash suite's driver).

import { loadFormat } from "./usage-dashboard-cells.ts";
import {
  FIDS,
  findEntry,
  firstDiff,
  type Group,
  type Tok,
  type View,
} from "./usage-dashboard-views.ts";

const TEXT_COLUMNS = [
  "key",
  "records",
  "uncaptured",
  "netInput",
  "cacheRead",
  "cacheWrite",
  "output",
  "reasoning",
  "fidelity",
  "price",
  "priced",
  "unpriced",
  "unconverted",
];
type Row = Record<string, string> & { section: string; next: string };
function parseText(txt: string): { lines: string[]; rows: Row[]; headers: string[][] } {
  const lines = txt.split("\n");
  const rows: Row[] = [];
  let section = "";
  let header: string[] | null = null;
  lines.forEach((line, i) => {
    if (!line.includes("|")) {
      const h = /^==\s*(.*?)\s*==$/.exec(line.trim());
      if (h) section = h[1]!;
      return;
    }
    const cells = line.split("|").map((c) => c.trim());
    if (cells[0] === "key" && cells[1] === "records") {
      header = cells;
      return;
    }
    const hdr: string[] | null = header;
    if (!hdr || cells.length !== hdr.length) return;
    const row = { section, next: lines[i + 1] ?? "" } as Row;
    hdr.forEach((h, j) => (row[h] = cells[j]!));
    rows.push(row);
  });
  return {
    lines,
    rows,
    headers: lines
      .filter((l) => /^\s*key\s*\|\s*records\b/.test(l))
      .map((l) => l.split("|").map((c) => c.trim())),
  };
}

/** 13.1/13.2 on form C: rows parse back to the view model, a `note:` line follows every price row. */
export function checkText(
  txt: string,
  v: View,
  mode: "volatile" | "recomputed",
): { errs: string[]; summary: string } {
  const fmt = loadFormat();
  const parsed = parseText(txt);
  const errs: string[] = [];
  if (/\x1b/.test(txt)) errs.push("the text report contains an ESC byte");
  if (parsed.headers.length === 0) errs.push('no header row "key | records | …" found');
  for (const h of parsed.headers)
    if (h.join("|") !== TEXT_COLUMNS.join("|"))
      errs.push(`header columns ${h.join(",")} != ${TEXT_COLUMNS.join(",")}`);
  const groupFor = (r: Row): Group | undefined => {
    const sec = r.section;
    if (sec === "Totals") return v.totals;
    const m = /^By (day|week|month)\b/.exec(sec);
    if (m) return findEntry(v.byBucket[m[1] as "day" | "week" | "month"], r["key"]!);
    if (sec === "By CLI") return findEntry(v.byCli, r["key"]!);
    if (sec === "By model")
      return findEntry(v.byModel, r["key"] === "(no model: uncaptured)" ? null : r["key"]!);
    if (/^Sessions/.test(sec))
      return (
        v.sessions.find((x) => x.sessionId === r["key"]) ??
        v.sessions.flatMap((x) => x.agents).find((y) => y.agentId === r["key"])
      );
    if (sec === "Tasks") return v.tasks.find((x) => x.taskHandoffKey === r["key"]);
    if (sec === "Assets")
      return v.assets.find((x) => `${x.kind}:${x.ref}` === r["key"] || x.ref === r["key"]);
    return undefined;
  };
  let checked = 0;
  let sawTotals = false;
  for (const r of parsed.rows) {
    const g = groupFor(r);
    if (!g) {
      if (/^(Totals|By |Tasks$)/.test(r.section))
        errs.push(`row "${r["key"]}" in section "${r.section}" maps to no group of the view model`);
      continue;
    }
    if (r.section === "Totals") sawTotals = true;
    checked += 1;
    const f =
      (FIDS as readonly string[]).includes(r["fidelity"]!) && r["records"] === "-"
        ? r["fidelity"]!
        : null;
    const tok: Tok = f ? g.tokens.byFidelity[f]! : g.tokens.combined;
    const pr = f ? g.price.byFidelity[f]! : g.price;
    const where = `${r.section} row "${r["key"]}"${f ? ` (${f})` : ""}`;
    if (!f) {
      if (r["records"] !== String(g.recordCount))
        errs.push(`${where} records "${r["records"]}" != ${g.recordCount}`);
      if (r["uncaptured"] !== String(g.uncapturedCount))
        errs.push(`${where} uncaptured "${r["uncaptured"]}" != ${g.uncapturedCount}`);
      const mixed = g.tokens.combined.mixed ?? [];
      if (fmt?.mixed && mixed.length > 1 && r["fidelity"] !== fmt.mixed(mixed))
        errs.push(`${where} fidelity "${r["fidelity"]}" != format.mixed() "${fmt.mixed(mixed)}"`);
      if (mixed.length === 1 && r["fidelity"] !== mixed[0])
        errs.push(`${where} fidelity "${r["fidelity"]}" != ${mixed[0]}`);
      if (pr.amount === null) {
        if (!/—/.test(r["price"]!) || (pr.absent && !r["price"]!.includes(pr.absent)))
          errs.push(`${where} price "${r["price"]}" is not the explicit absence "${pr.absent}"`);
      } else {
        if (!r["price"]!.includes(pr.amount.toFixed(6)))
          errs.push(`${where} price "${r["price"]}" does not carry ${pr.amount.toFixed(6)}`);
        if (fmt?.money && r["price"] !== fmt.money(pr.amount, g.price.currency))
          errs.push(
            `${where} price "${r["price"]}" != format.money() "${fmt.money(pr.amount, g.price.currency)}"`,
          );
      }
    }
    for (const k of ["netInput", "cacheRead", "output", "reasoning"] as const)
      if (r[k] !== String(tok[k])) errs.push(`${where} ${k} "${r[k]}" != ${tok[k]}`);
    const cw =
      typeof tok.cacheWrite === "object"
        ? Object.fromEntries(
            r["cacheWrite"]!.split(";")
              .map((x) => x.split("="))
              .map(([a, b]) => [a, Number(b)]),
          )
        : Number(r["cacheWrite"]);
    const dcw = firstDiff(cw, tok.cacheWrite, "cacheWrite");
    if (dcw !== null) errs.push(`${where} ${dcw}`);
    if (r["priced"] !== String(pr.pricedCount))
      errs.push(`${where} priced "${r["priced"]}" != ${pr.pricedCount}`);
    if (r["unpriced"] !== String(pr.unpricedCount))
      errs.push(`${where} unpriced "${r["unpriced"]}" != ${pr.unpricedCount}`);
    if (r["unconverted"] !== String(pr.unconvertedCount))
      errs.push(`${where} unconverted "${r["unconverted"]}" != ${pr.unconvertedCount}`);
  }
  if (!sawTotals) errs.push("no row under the Totals section");
  for (const r of parsed.rows) {
    if (r["price"] === undefined || r["price"] === "" || r["price"] === "-") continue;
    if (!/^\s*note: /.test(r.next))
      errs.push(
        `row "${r["key"]}" (section ${r.section}) with a price is not followed by a "note: " line`,
      );
    else if (!/reference figure, not an invoice/.test(r.next))
      errs.push(`note after row "${r["key"]}" lacks the reference-figure statement`);
  }
  if (fmt?.priceStatement) {
    const mask = (l: string): string =>
      (mode === "recomputed"
        ? l.replace(/computed \S+( to \S+)?$/, "computed <recomputed>")
        : l
      ).trim();
    const want = `note: ${fmt.priceStatement(v.totals.price)}`;
    if (!parsed.lines.some((l) => mask(l) === mask(want)))
      errs.push(`no note line equals the totals price statement "${want}"`);
  }
  return { errs: errs.slice(0, 10), summary: `OK ${checked} rows` };
}

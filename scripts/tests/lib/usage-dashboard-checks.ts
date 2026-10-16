// usage-dashboard-checks.ts — whole-view identities of the usage dashboard suites: D3's partition identities,
// the 13.6 bucket sums, the 0209 cross-check mapping, the usage-query token comparison, the ISO-week
// helpers and the extraction of a page's embedded view model (ported from the Bash suite's driver).

import {
  addGroups,
  amountEq,
  entryKey,
  FIDS,
  firstDiff,
  groupDiff,
  groupsOf,
  parseView,
  TALLIES,
  zeroGroup,
  type Entry,
  type Group,
  type Tok,
  type View,
} from "./usage-dashboard-views.ts";

const COUNTS = ["recordCount", "capturedCount", "uncapturedCount"] as const;

/** D3's partition identities in every group of a view; returns the problems (empty = fine) and the group count. */
export function partition(v: View): { errs: string[]; groups: number } {
  const errs: string[] = [];
  const groups = groupsOf(v);
  for (const [p, g] of groups) {
    for (const k of COUNTS)
      if (!Number.isInteger(g[k])) errs.push(`${p}.${k} is not an integer: ${g[k]}`);
    for (const k of TALLIES)
      if (!Number.isInteger(g.price[k]))
        errs.push(`${p}.price.${k} is not an integer: ${g.price[k]}`);
    if (g.capturedCount + g.uncapturedCount !== g.recordCount)
      errs.push(
        `${p}: captured ${g.capturedCount} + uncaptured ${g.uncapturedCount} != records ${g.recordCount}`,
      );
    if (v.pricing.available !== false) {
      const s = g.price.pricedCount + g.price.unpricedCount + g.price.unconvertedCount;
      if (s !== g.capturedCount)
        errs.push(`${p}: priced+unpriced+unconverted ${s} != captured ${g.capturedCount}`);
    }
    for (const t of TALLIES) {
      const s = FIDS.reduce((acc, f) => acc + (g.price.byFidelity[f]?.[t] ?? Number.NaN), 0);
      if (s !== g.price[t]) errs.push(`${p}: sum over fidelities of ${t} ${s} != ${g.price[t]}`);
    }
    if (g.price.pricedCount === 0 && g.price.amount !== null)
      errs.push(
        `${p}: pricedCount 0 but amount ${g.price.amount} (R4: never a zero standing in for a price)`,
      );
    if (g.price.amount === null && !g.price.absent)
      errs.push(`${p}: amount null without an absent reason`);
  }
  if (groups.length === 0) errs.push("no group found in the view");
  return { errs, groups: groups.length };
}

/** 13.6: sum day = week = month = byCli = byModel = totals, keys ascending. */
export function sums(v: View): string[] {
  const errs: string[] = [];
  const dims: [string, Entry[]][] = [
    ["byBucket.day", v.byBucket.day],
    ["byBucket.week", v.byBucket.week],
    ["byBucket.month", v.byBucket.month],
    ["byCli", v.byCli],
    ["byModel", v.byModel],
  ];
  for (const [name, list] of dims) {
    if (list.length === 0) {
      errs.push(`${name} is empty or missing`);
      continue;
    }
    const d = groupDiff(
      list.reduce<Group>((acc, e) => addGroups(acc, e), zeroGroup()),
      v.totals,
      1e-12,
    );
    if (d !== null) errs.push(`Σ ${name} != totals: ${d}`);
    const keys = list.map((e) => String(entryKey(e)));
    if (name.startsWith("byBucket") && keys.join("\n") !== [...keys].sort().join("\n"))
      errs.push(`${name} keys are not ascending: ${keys.join(",")}`);
  }
  return errs;
}

export interface Rollup0209 {
  currency: string;
  uncapturedCount: number;
  byFidelity: Record<
    string,
    {
      sum: number;
      count: number;
      pricedCount: number;
      unpricedCount: number;
      unconvertedCount: number;
    }
  >;
  combined: { sum: number; unpricedCount: number; unconvertedCount: number; mixed: string[] };
}
/** v1-F5/v2-F3's explicit mapping of totals.price onto spec 0209's rollup() (no count row for combined). */
export function cross0209(v: View, r: Rollup0209): string[] {
  const errs: string[] = [];
  const p = v.totals.price;
  for (const f of FIDS) {
    const d = p.byFidelity[f]!;
    const o = r.byFidelity[f]!;
    if (!amountEq(d.amount ?? 0, o.sum))
      errs.push(`${f}: amount ?? 0 = ${d.amount} != sum ${o.sum}`);
    if (d.pricedCount + d.unpricedCount + d.unconvertedCount !== o.count)
      errs.push(`${f}: tally sum != count ${o.count}`);
    for (const t of TALLIES) if (d[t] !== o[t]) errs.push(`${f}: ${t} ${d[t]} != ${o[t]}`);
    if (r.currency === "USD" && d.unconvertedCount !== 0)
      errs.push(`${f}: unconvertedCount ${d.unconvertedCount} != 0 under USD`);
  }
  if (!amountEq(p.amount ?? 0, r.combined.sum))
    errs.push(`combined: amount ?? 0 = ${p.amount} != sum ${r.combined.sum}`);
  if (p.unpricedCount !== r.combined.unpricedCount)
    errs.push(`combined: unpricedCount ${p.unpricedCount} != ${r.combined.unpricedCount}`);
  if (p.unconvertedCount !== r.combined.unconvertedCount)
    errs.push(`combined: unconvertedCount ${p.unconvertedCount} != ${r.combined.unconvertedCount}`);
  const dm = firstDiff(p.mixed, r.combined.mixed, "mixed");
  if (dm !== null) errs.push(`combined: ${dm}`);
  if (v.totals.uncapturedCount !== r.uncapturedCount)
    errs.push(`uncapturedCount ${v.totals.uncapturedCount} != ${r.uncapturedCount}`);
  return errs;
}

export interface QueryRollup {
  uncapturedCount: number;
  byFidelity: Record<string, Tok>;
  combined: Tok;
}
/** A group's tokens against `usage-query --rollup --combined`. */
export function tokensEq(g: Group | undefined, r: QueryRollup, label: string): string[] {
  if (!g) return [`${label} does not resolve`];
  const errs: string[] = [];
  for (const f of FIDS) {
    const d = firstDiff(g.tokens.byFidelity[f], r.byFidelity[f], `tokens.byFidelity.${f}`);
    if (d !== null) errs.push(d);
  }
  const d = firstDiff(g.tokens.combined, r.combined, "tokens.combined");
  if (d !== null) errs.push(d);
  if (g.uncapturedCount !== r.uncapturedCount)
    errs.push(`uncapturedCount ${g.uncapturedCount} != ${r.uncapturedCount}`);
  return errs;
}

const DAY = 86400000;
export function isoWeekKey(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const thursday = new Date(d.getTime() + (3 - ((d.getUTCDay() + 6) % 7)) * DAY);
  const year = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week1 = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * DAY);
  return `${year}-W${String(Math.floor((thursday.getTime() - week1.getTime()) / (7 * DAY)) + 1).padStart(2, "0")}`;
}
export function isoWeekBounds(day: string): [string, string] {
  const d = new Date(`${day}T00:00:00Z`);
  const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY);
  return [
    monday.toISOString().slice(0, 10),
    new Date(monday.getTime() + 6 * DAY).toISOString().slice(0, 10),
  ];
}
export function lastDayOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);
}

/** The one embedded `<script type="application/json">` block of a page, parsed. */
export function extractEmbedded(html: string): View {
  const blocks = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script/gi)];
  if (blocks.length !== 1)
    throw new Error(`expected exactly one <script> block, found ${blocks.length}`);
  if (!/type="application\/json"/.test(blocks[0]![1]!))
    throw new Error(`the one <script> block is not type="application/json": ${blocks[0]![1]}`);
  return parseView(blocks[0]![2]!);
}

// usage-dashboard-cells.ts — the rendering checks of cases 13.1/13.2 (ported from the embedded driver of
// test-usage-dashboard.sh): every `data-k` cell of forms A and B equals format(<model value>), a
// `price-statement` span follows every `.price.amount` cell, and form C's text rows parse back to the view
// model with a `note:` line after every price row. format.js is the implementation's own formatter, loaded
// from the tree under test.

import { createRequire } from "node:module";
import path from "node:path";

import { REPO } from "./usage-dashboard-rig.ts";
import {
  FIDS,
  findEntry,
  firstDiff,
  isObj,
  type Entry,
  type Group,
  type Price,
  type Tok,
  type View,
} from "./usage-dashboard-views.ts";

export interface Format {
  money?(v: number, currency?: string): string;
  mixed?(v: string[]): string;
  cell?(view: View, p: string): unknown;
  priceStatement?(price: Price): string;
}
export const loadFormat = (): Format | null => {
  try {
    return createRequire(import.meta.url)(
      path.join(REPO, "scripts/lib/usage-dashboard/format.js"),
    ) as Format;
  } catch {
    return null;
  }
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}
export const textOf = (inner: string): string =>
  decodeEntities(inner.replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();

function resolvePath(view: unknown, p: string): unknown {
  let cur: unknown = view;
  for (const m of p.matchAll(/([^.[\]]+)|\[([^\]]*)\]/g)) {
    const s = m[1] ?? m[2] ?? "";
    if (cur === undefined || cur === null) return undefined;
    if (Array.isArray(cur))
      cur = /^\d+$/.test(s) ? (cur as unknown[])[Number(s)] : findEntry(cur as Entry[], s);
    else cur = (cur as Record<string, unknown>)[s];
  }
  return cur;
}
const parentPath = (p: string): string => p.replace(/(\.[^.[\]]+|\[[^\]]*\])$/, "");

export interface Cell {
  readonly path: string;
  readonly text: string;
  readonly after: string;
}
export function htmlCells(html: string): Cell[] {
  const cells: Cell[] = [];
  for (const m of html.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*?)\sdata-k="([^"]*)"([^>]*)>/g)) {
    const tag = m[1]!;
    const openEnd = m.index + m[0].length;
    const close = html.indexOf(`</${tag}>`, openEnd);
    if (close === -1) continue;
    const closeEnd = close + tag.length + 3;
    cells.push({
      path: decodeEntities(m[3]!),
      text: textOf(html.slice(openEnd, close)),
      after: html.slice(closeEnd, closeEnd + 4000),
    });
  }
  return cells;
}
function nextStatement(after: string): { path: string | null; text: string } | null {
  const m = /^\s*<span\b([^>]*)>([\s\S]*?)<\/span>/.exec(after);
  if (!m || !/class="[^"]*\bprice-statement\b[^"]*"/.test(m[1]!)) return null;
  const s = /data-s="([^"]*)"/.exec(m[1]!);
  return { path: s ? decodeEntities(s[1]!) : null, text: textOf(m[2]!) };
}

function checkCellText(view: View, cell: Cell, fmt: Format | null): string | null {
  const v = resolvePath(view, cell.path);
  if (v === undefined) return `data-k="${cell.path}" does not resolve in the view model`;
  if (/(^|\.)amount$/.test(cell.path) && /price/.test(cell.path)) {
    const price = resolvePath(view, parentPath(cell.path)) as Price | undefined;
    const group = resolvePath(
      view,
      parentPath(parentPath(cell.path).replace(/\.byFidelity$/, "")),
    ) as Group | undefined;
    if (v === null) {
      const absent = price?.absent ?? group?.price.absent;
      if (!/—/.test(cell.text))
        return `data-k="${cell.path}" is null but its text "${cell.text}" carries no em dash`;
      if (absent && !cell.text.includes(absent))
        return `data-k="${cell.path}" is null but its text "${cell.text}" does not name the absence "${absent}"`;
      return null;
    }
    const n = v as number;
    const currency = price?.currency ?? view.pricing.currency ?? view.selection.currency;
    if (!cell.text.includes(n.toFixed(6)))
      return `data-k="${cell.path}" text "${cell.text}" does not carry ${n.toFixed(6)}`;
    if (currency && !cell.text.includes(currency))
      return `data-k="${cell.path}" text "${cell.text}" does not carry the currency ${currency}`;
    if (fmt?.money && fmt.money(n, currency) !== cell.text)
      return `data-k="${cell.path}" text "${cell.text}" != format.money() "${fmt.money(n, currency)}"`;
    return null;
  }
  if (typeof v === "number")
    return cell.text === String(v) ? null : `data-k="${cell.path}" text "${cell.text}" != ${v}`;
  if (Array.isArray(v)) {
    for (const f of v as string[])
      if (!cell.text.includes(f))
        return `data-k="${cell.path}" text "${cell.text}" does not name ${f}`;
    if (fmt?.mixed && !cell.text.includes(fmt.mixed(v as string[])))
      return `data-k="${cell.path}" text "${cell.text}" does not carry format.mixed() "${fmt.mixed(v as string[])}"`;
    return null;
  }
  if (isObj(v)) {
    const parsed: Record<string, number> = {};
    for (const part of cell.text.split(";")) {
      const [k, n] = part.split("=");
      if (k !== undefined && n !== undefined) parsed[k.trim()] = Number(n);
    }
    const d = firstDiff(parsed, v, cell.path);
    return d === null
      ? null
      : `data-k="${cell.path}" text "${cell.text}" does not parse back: ${d}`;
  }
  if (typeof v === "string")
    return cell.text === v ? null : `data-k="${cell.path}" text "${cell.text}" != "${v}"`;
  return /—/.test(cell.text) || cell.text === ""
    ? null
    : `data-k="${cell.path}" null rendered as "${cell.text}"`;
}
function statementProblem(text: string, price: Price): string | null {
  if (!/reference figure, not an invoice/.test(text))
    return 'the statement lacks "reference figure, not an invoice"';
  const ts = price.timestamps ?? {};
  if (ts.snapshotSha && !text.includes(ts.snapshotSha))
    return `the statement lacks the snapshot sha ${ts.snapshotSha}`;
  if (ts.snapshotFetchedAt && !text.includes(ts.snapshotFetchedAt))
    return `the statement lacks the snapshot fetchedAt ${ts.snapshotFetchedAt}`;
  if (ts.computedAt?.max && !text.includes(ts.computedAt.max))
    return `the statement lacks computedAt ${ts.computedAt.max}`;
  return null;
}

/** 13.1/13.2 on a page: problems (empty = fine) and a one-line summary. */
export function checkCells(html: string, v: View): { errs: string[]; summary: string } {
  const fmt = loadFormat();
  const cells = htmlCells(html);
  const errs: string[] = [];
  let priceCells = 0;
  for (const c of cells) {
    const e = checkCellText(v, c, fmt);
    if (e !== null) errs.push(e);
    else if (fmt?.cell) {
      const want = String(fmt.cell(v, c.path)).replace(/\s+/g, " ").trim();
      if (c.text !== want)
        errs.push(`data-k="${c.path}" text "${c.text}" != format.cell() "${want}"`);
    }
    if (!/\.price\.amount$/.test(c.path)) continue;
    priceCells += 1;
    const st = nextStatement(c.after);
    const pricePath = parentPath(c.path);
    if (!st) {
      errs.push(
        `data-k="${c.path}" is not immediately followed by a <span class="price-statement" data-s>`,
      );
      continue;
    }
    if (st.path !== parentPath(pricePath) && st.path !== pricePath)
      errs.push(
        `data-k="${c.path}" is followed by data-s="${st.path}", not its own group path "${parentPath(pricePath)}"`,
      );
    const price = resolvePath(v, pricePath) as Price | undefined;
    if (!price) errs.push(`price path ${pricePath} does not resolve`);
    else {
      if (fmt?.priceStatement && st.text !== textOf(fmt.priceStatement(price)))
        errs.push(
          `statement after ${c.path}: "${st.text}" != format.priceStatement() "${fmt.priceStatement(price)}"`,
        );
      const e2 = statementProblem(st.text, price);
      if (e2 !== null) errs.push(`statement after ${c.path}: ${e2}`);
    }
  }
  const statements =
    (html.match(/<span\b[^>]*class="[^"]*\bprice-statement\b[^"]*"[^>]*data-s="/g) ?? []).length +
    (html.match(/<span\b[^>]*data-s="[^"]*"[^>]*class="[^"]*\bprice-statement\b/g) ?? []).length;
  if (cells.length === 0) errs.push("no data-k cell found");
  if (priceCells === 0) errs.push("no .price.amount cell found");
  if (statements !== priceCells)
    errs.push(`${priceCells} .price.amount cells but ${statements} data-s price statements`);
  for (const need of [
    "totals.recordCount",
    "totals.uncapturedCount",
    "totals.price.unpricedCount",
    "totals.price.amount",
  ]) {
    if (!cells.some((c) => c.path === need))
      errs.push(`no data-k="${need}" cell (R8: the count is never omitted)`);
  }
  return { errs: errs.slice(0, 10), summary: `OK ${cells.length} cells, ${priceCells} prices` };
}

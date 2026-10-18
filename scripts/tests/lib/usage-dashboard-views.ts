// usage-dashboard-views.ts — typed view-model helpers of the usage dashboard suites, lifted from the
// embedded Node driver of the Bash suite test-usage-dashboard.sh: the suite's OWN normalisers (the
// implementation's NORMALISE_* exports are compared with them, never trusted in their place), the group
// algebra, the D3 partition identities, the 0209 cross-check mapping and the ISO-week helpers.

export type Obj = Record<string, unknown>;
export const FIDS = ["per-request", "run-total", "session-cumulative"] as const;
export const TALLIES = ["pricedCount", "unpricedCount", "unconvertedCount"] as const;
const COUNTS = ["recordCount", "capturedCount", "uncapturedCount"] as const;
const CLASSES = ["netInput", "cacheRead", "cacheWrite", "output", "reasoning"] as const;

export interface Tok {
  netInput: number;
  cacheRead: number;
  cacheWrite: number | Record<string, number>;
  output: number;
  reasoning: number;
  cacheWriteTiered?: boolean;
  mixed?: string[];
}
export interface Price {
  amount: number | null;
  pricedCount: number;
  unpricedCount: number;
  unconvertedCount: number;
  absent?: string;
  currency?: string;
  mixed?: string[];
  timestamps?: { snapshotSha?: string; snapshotFetchedAt?: string; computedAt?: { max?: string } };
  byFidelity: Record<string, Price>;
}
export interface Group {
  recordCount: number;
  capturedCount: number;
  uncapturedCount: number;
  tokens: { byFidelity: Record<string, Tok>; combined: Tok };
  price: Price;
}
export type Entry = Group & { key?: string | null; cli?: string; modelId?: string | null };
export type Session = Group & {
  sessionId: string;
  agents: (Group & { agentId: string })[];
};
export interface View {
  schema: string;
  totals: Group;
  byBucket: Record<"day" | "week" | "month", Entry[]>;
  byCli: Entry[];
  byModel: Entry[];
  sessions: Session[];
  tasks: (Group & { taskHandoffKey: string })[];
  assets: (Group & { kind: string; ref: string })[];
  pricing: { currency?: string; available?: boolean };
  selection: { currency?: string };
  empty?: string;
}

export const isObj = (v: unknown): v is Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v);
export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
export const parseView = (text: string): View => JSON.parse(text) as View;

export function walk(v: unknown, fn: (o: Obj) => void): void {
  if (Array.isArray(v)) v.forEach((x) => walk(x, fn));
  else if (isObj(v)) {
    fn(v);
    Object.values(v).forEach((x) => walk(x, fn));
  }
}

export function normVolatile<T>(v: T): T {
  const c = clone(v) as unknown as Obj;
  delete c["generatedAt"];
  return c as T;
}
export function normRecomputed<T>(v: T): T {
  const c = normVolatile(v);
  walk(c, (o) => {
    const p = o["price"];
    if (isObj(p) && isObj(p["timestamps"])) delete p["timestamps"]["computedAt"];
  });
  return c;
}

/** First differing path between two JSON values (null when equal); `p` is the path prefix. */
export function firstDiff(a: unknown, b: unknown, p = ""): string | null {
  if (a === b) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") {
    return `${p || "<root>"}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return `${p}: array vs object`;
  const x = a as Obj;
  const y = b as Obj;
  for (const k of [...new Set([...Object.keys(x), ...Object.keys(y)])].sort()) {
    const d = firstDiff(x[k], y[k], p ? `${p}.${k}` : k);
    if (d !== null) return d;
  }
  return null;
}

const zeroTokens = (): Tok => ({
  netInput: 0,
  cacheRead: 0,
  cacheWrite: 0,
  output: 0,
  reasoning: 0,
  cacheWriteTiered: false,
});
const zeroPrice = (): Price => ({
  amount: null,
  pricedCount: 0,
  unpricedCount: 0,
  unconvertedCount: 0,
  byFidelity: {},
});
export function zeroGroup(): Group {
  const byFidelity: Record<string, Tok> = {};
  const priceBy: Record<string, Price> = {};
  for (const f of FIDS) {
    byFidelity[f] = zeroTokens();
    priceBy[f] = zeroPrice();
  }
  return {
    recordCount: 0,
    capturedCount: 0,
    uncapturedCount: 0,
    tokens: { byFidelity, combined: { ...zeroTokens(), mixed: [] } },
    price: { ...zeroPrice(), byFidelity: priceBy, mixed: [] },
  };
}
function addTokens(a: Tok, b: Tok): Tok {
  const out: Tok = { ...a };
  for (const k of ["netInput", "cacheRead", "output", "reasoning"] as const) out[k] = a[k] + b[k];
  if (typeof a.cacheWrite === "number" && typeof b.cacheWrite === "number")
    out.cacheWrite = a.cacheWrite + b.cacheWrite;
  else {
    const m: Record<string, number> = {};
    for (const side of [a.cacheWrite, b.cacheWrite]) {
      if (typeof side === "object")
        for (const [k, v] of Object.entries(side)) m[k] = (m[k] ?? 0) + v;
      else if (side) m["untiered"] = (m["untiered"] ?? 0) + side;
    }
    out.cacheWrite = m;
  }
  out.cacheWriteTiered = Boolean(a.cacheWriteTiered || b.cacheWriteTiered);
  return out;
}
const addAmount = (a: number | null, b: number | null): number | null =>
  a === null ? b : b === null ? a : a + b;
export function addGroups(a: Group, b: Group): Group {
  const out = clone(a);
  for (const k of COUNTS) out[k] = a[k] + b[k];
  for (const f of FIDS) {
    out.tokens.byFidelity[f] = addTokens(a.tokens.byFidelity[f]!, b.tokens.byFidelity[f]!);
    const pa = a.price.byFidelity[f]!;
    const pb = b.price.byFidelity[f]!;
    const dst = out.price.byFidelity[f]!;
    dst.amount = addAmount(pa.amount, pb.amount);
    for (const t of TALLIES) dst[t] = pa[t] + pb[t];
  }
  const mixed = FIDS.filter(
    (f) =>
      (a.tokens.combined.mixed ?? []).includes(f) || (b.tokens.combined.mixed ?? []).includes(f),
  );
  out.tokens.combined = { ...addTokens(a.tokens.combined, b.tokens.combined), mixed };
  out.price.amount = addAmount(a.price.amount, b.price.amount);
  for (const t of TALLIES) out.price[t] = a.price[t] + b.price[t];
  return out;
}

/** Amounts compare EXACTLY by default; only the 13.6 sums re-associate, with a 1e-12 relative tolerance. */
export function amountEq(
  a: number | null | undefined,
  b: number | null | undefined,
  tol = 0,
): boolean {
  if (a === null || a === undefined || b === null || b === undefined)
    return (a ?? null) === (b ?? null);
  return tol === 0 ? a === b : Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
}
function tokensDiff(a: Tok, b: Tok, p: string): string | null {
  for (const k of CLASSES) {
    const d = firstDiff(a[k], b[k], `${p}.${k}`);
    if (d !== null) return d;
  }
  return null;
}
/** Per fidelity: tokens, price amounts and the tallies; undefined stands for the zero group. */
export function groupDiff(a?: Group, b?: Group, tol = 0): string | null {
  const x = a ?? zeroGroup();
  const y = b ?? zeroGroup();
  for (const k of COUNTS) if (x[k] !== y[k]) return `${k}: ${x[k]} != ${y[k]}`;
  for (const f of FIDS) {
    const d = tokensDiff(
      x.tokens.byFidelity[f]!,
      y.tokens.byFidelity[f]!,
      `tokens.byFidelity.${f}`,
    );
    if (d !== null) return d;
    const pa = x.price.byFidelity[f]!;
    const pb = y.price.byFidelity[f]!;
    if (!amountEq(pa.amount, pb.amount, tol))
      return `price.byFidelity.${f}.amount: ${pa.amount} != ${pb.amount}`;
    for (const t of TALLIES)
      if (pa[t] !== pb[t]) return `price.byFidelity.${f}.${t}: ${pa[t]} != ${pb[t]}`;
  }
  const d = tokensDiff(x.tokens.combined, y.tokens.combined, "tokens.combined");
  if (d !== null) return d;
  const dm = firstDiff(x.tokens.combined.mixed, y.tokens.combined.mixed, "tokens.combined.mixed");
  if (dm !== null) return dm;
  if (!amountEq(x.price.amount, y.price.amount, tol))
    return `price.amount: ${x.price.amount} != ${y.price.amount}`;
  for (const t of TALLIES)
    if (x.price[t] !== y.price[t]) return `price.${t}: ${x.price[t]} != ${y.price[t]}`;
  return null;
}
export function entryKey(e: Entry): string | null | undefined {
  if ("key" in e) return e.key;
  if ("cli" in e) return e.cli;
  if ("modelId" in e) return e.modelId;
  return undefined;
}
export const findEntry = (list: Entry[] | undefined, key: string | null): Entry | undefined =>
  (list ?? []).find((e) => entryKey(e) === key);

/** Every object of a view that is a group (it has recordCount, price and tokens), with its path. */
export function groupsOf(view: unknown): [string, Group][] {
  const out: [string, Group][] = [];
  const visit = (o: unknown, p: string): void => {
    if (Array.isArray(o)) o.forEach((x, i) => visit(x, `${p}[${i}]`));
    else if (isObj(o)) {
      if ("recordCount" in o && isObj(o["price"]) && isObj(o["tokens"]))
        out.push([p, o as unknown as Group]);
      for (const [k, v] of Object.entries(o)) visit(v, p ? `${p}.${k}` : k);
    }
  };
  visit(view, "");
  return out;
}

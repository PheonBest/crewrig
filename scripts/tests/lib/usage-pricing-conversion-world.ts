// usage-pricing-conversion-world.ts — fixtures and helpers of the delta-02 conversion
// group (Case 19, spec 0260 row J1a), shared by usage-pricing-conversion.test.ts and
// usage-pricing-conversion-b.test.ts. Imported only; it registers no test.

/* oxlint-disable typescript/no-explicit-any, typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-return, typescript/no-unsafe-argument -- the entries emit untyped JSON */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  FIXTURES,
  driver,
  entry,
  makeRecord,
  writeJson,
  type Case,
  type Checkout,
} from "./usage-pricing-rig.ts";

const REC: Record<string, Parameters<typeof makeRecord>[0]> = {
  p0: {
    session: "c19-p0",
    idemKey: "c19-p0",
    requestInstant: "2026-09-10T10:00:00.000Z",
    netInput: 1000,
    output: 0,
  },
  p1: {
    session: "c19-p1",
    idemKey: "c19-p1",
    requestInstant: "2026-09-10T11:00:00.000Z",
    netInput: 2000,
    output: 0,
  },
  p2: {
    session: "c19-p2",
    idemKey: "c19-p2",
    requestInstant: "2026-09-10T12:00:00.000Z",
    netInput: 3000,
    output: 0,
  },
  u1: {
    session: "c19-u1",
    idemKey: "c19-u1",
    requestInstant: "2026-09-10T13:00:00.000Z",
    output: 0,
    modelId: "totally-unresolvable-model-xyz",
  },
  s1a: {
    session: "c19-s1",
    idemKey: "c19-s1a",
    requestInstant: "2026-09-11T10:00:00.000Z",
    netInput: 100,
    output: 0,
    fidelity: "session-cumulative",
  },
  s1b: {
    session: "c19-s1",
    idemKey: "c19-s1b",
    requestInstant: "2026-09-11T12:00:00.000Z",
    netInput: 400,
    output: 0,
    fidelity: "session-cumulative",
  },
  x1: {
    kind: "uncaptured",
    session: "c19-x1",
    idemKey: "c19-x1",
    requestInstant: "2026-09-10T14:00:00.000Z",
    uncapturedReason: "c19: transcript unavailable",
  },
};

/** One Case 19 world: a pinned root, its record files and the helpers over it. */
export class World {
  readonly files: Record<string, string> = {};
  p0Eur: number | string = "not-converted";
  readonly co: Checkout;
  readonly c: Case;
  constructor(co: Checkout, c: Case) {
    this.co = co;
    this.c = c;
    for (const [name, opts] of Object.entries(REC))
      this.files[name] = writeJson(c, `c19-${name}.json`, makeRecord(opts));
  }
  write(...names: string[]): void {
    for (const n of names) {
      const r = driver(this.co, this.c, "write", [this.files[n]!]);
      assert.ok(
        r.stdout.includes("STATUS=stored"),
        `Case 19 fixture record ${n} did NOT store: ${r.stdout}`,
      );
    }
  }
  seedFx(): void {
    for (const d of ["2026-09-18", "2026-09-21"])
      driver(this.co, this.c, "seed-fx", [path.join(FIXTURES, "fx", `${d}.json`)]);
  }
  /** Every record but p2, p0 stored in EUR while both fixings were cached, then the fx cache removed. */
  seedRoot(): this {
    this.write("p0", "p1", "u1", "s1a", "s1b", "x1");
    this.seedFx();
    const p = this.price("p0", "EUR");
    if (p.conversion?.status === "ok" && p.currency === "EUR") this.p0Eur = p.amount;
    fs.rmSync(path.join(this.c.root, "fx"), { recursive: true, force: true });
    return this;
  }
  price(name: string, ccy = "USD"): any {
    const r = driver(this.co, this.c, "price-record", [this.files[name]!], { PRICE_CURRENCY: ccy });
    return JSON.parse(r.stdout);
  }
  rollup(ccy: string): any {
    const r = entry(this.co, this.c, "usage-price", [
      "--period",
      "2026-09",
      "--cli",
      "claude-code",
      "--rollup",
      "--currency",
      ccy,
    ]);
    assert.equal(r.status, 0, `--rollup --currency ${ccy} exited ${r.status}`);
    return JSON.parse(r.stdout);
  }
  dash(ccy: string): any {
    const r = entry(this.co, this.c, "usage-dashboard", [
      "report",
      "--json",
      "--period",
      "2026-09",
      "--cli",
      "claude-code",
      "--currency",
      ccy,
    ]);
    assert.equal(r.status, 0, `dashboard ${ccy} exited ${r.status}`);
    return JSON.parse(r.stdout);
  }
  stored(name: string): any {
    const id = makeRecord(REC[name]).recordId as string;
    const find = (dir: string): string | undefined => {
      if (!fs.existsSync(dir)) return undefined;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          const hit = find(full);
          if (hit) return hit;
        } else if (e.name === `${id}.price.json`) return full;
      }
      return undefined;
    };
    const f = find(path.join(this.c.root, "prices"));
    return f ? JSON.parse(fs.readFileSync(f, "utf8")) : {};
  }
  /** Plant a pre-delta stored failure: the USD amount labelled EUR (19g). */
  plantLegacy(): void {
    const v = this.stored("p1");
    const legacy = writeJson(this.c, "c19g-legacy.json", {
      ...v,
      amount: v.amountUsd,
      currency: "EUR",
      fixingDate: null,
      conversion: { status: "no-fixing-on-or-before", requested: "EUR" },
    });
    driver(this.co, this.c, "plant-price", [this.files["p1"]!, legacy]);
  }
}

export const bucket = (r: any, f: string): string => {
  const b = r.byFidelity?.[f] ?? {};
  return [b.sum, b.count, b.pricedCount, b.unpricedCount, b.unconvertedCount].join("|");
};
export const tail = (s: string): string => s.split("|").slice(1).join("|");
export const sum = (s: string): number => Number(s.split("|")[0]);
export const partition = (r: any): boolean =>
  ["per-request", "run-total", "session-cumulative"].every((f) => {
    const b = r.byFidelity[f];
    return b.pricedCount + b.unpricedCount + b.unconvertedCount === b.count;
  });
export const noUnconverted = (r: any): boolean =>
  ["per-request", "run-total", "session-cumulative"].every(
    (f) => r.byFidelity[f].unconvertedCount === 0,
  ) && r.combined.unconvertedCount === 0;
export const dashSc = (v: any): string => {
  const p = v.totals?.price?.byFidelity?.["session-cumulative"] ?? {};
  return [p.amount ?? 0, p.pricedCount, p.unpricedCount, p.unconvertedCount].join("|");
};
export const s1Fixing = (v: any): unknown =>
  ((v.sessions ?? []) as any[]).find((s: any) => s.sessionId === "c19-s1")?.price?.timestamps
    ?.fixingDate;
export const pairCalls = (out: string): string[] => {
  const l = out.split("\n");
  return [l[1] ?? "", l[3] ?? ""];
};

// usage-pricing-case-kit.ts — small helpers shared by the usage-pricing rollup suites
// (spec 0260, row J1a): a pinned-case factory over one shared checkout, a one-mutation
// runner (a missing needle throws), and a journal-write helper.

/* oxlint-disable typescript/no-explicit-any, typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-return, typescript/no-unsafe-argument -- the entries emit untyped JSON */
import assert from "node:assert/strict";
import {
  driver,
  makeRecord,
  mutate,
  pinnedCase,
  writeJson,
  type Case,
  type Checkout,
  type RecordOptions,
} from "./usage-pricing-rig.ts";

/** Run `fn` against a pinned case of a checkout carrying one mutation. */
export function onMutant<T>(
  rel: string,
  needle: string,
  repl: string,
  fn: (m: Checkout, c: Case) => T,
): T {
  const m = mutate(rel, needle, repl);
  const c = pinnedCase(m);
  try {
    return fn(m, c);
  } finally {
    c.dispose();
    m.dispose();
  }
}

/** Write one record straight into the journal and assert it stored. */
export function put(m: Checkout, c: Case, name: string, opts: RecordOptions): Record<string, any> {
  const record = makeRecord(opts);
  const r = driver(m, c, "write", [writeJson(c, `${name}.json`, record)]);
  assert.match(r.stdout, /STATUS=stored/, `fixture record ${name} did not store`);
  return record;
}

export function json(r: { status: number | null; stdout: string }): any {
  assert.equal(r.status, 0);
  return JSON.parse(r.stdout);
}

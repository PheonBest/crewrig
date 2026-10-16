// usage-dashboard-home-marker.test.ts — the HOME marker of the usage dashboard suite (spec 0216 delta-01
// classification; replaces the last block of test-usage-dashboard.sh, spec 0260 row J1a). The classifier is
// a pure function over the before/after file lists of `$HOME/.crewrig/usage`; the live check snapshots the
// real home read-only around a dashboard run done under a temp HOME and feeds the classifier.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { dash, freshSandbox } from "./lib/usage-dashboard-rig.ts";
import { cleanupAll } from "./lib/worktree-fixtures.ts";

after(() => cleanupAll());

const base = (p: string): string => p.split(/[\\/]/).pop()!;
const isIn = (p: string, queue: string): boolean =>
  p.split("\\").join("/").includes(`/mirror/${queue}/`);

/**
 * Offenders of a before/after difference (spec 0216 delta-01): a removed path is excused only when it was
 * under mirror/pending and an identically named file now sits under mirror/mirrored (R2); every other
 * removal offends; an added path offends only when its basename names a file the suite itself produced (R3).
 */
export function classifyHomeDiff(
  before: readonly string[],
  after: readonly string[],
  ownBasenames: ReadonlySet<string>,
): string[] {
  const mirrored = new Set(after.filter((p) => isIn(p, "mirrored")).map(base));
  const afterSet = new Set(after);
  const beforeSet = new Set(before);
  const removed = before.filter((p) => !afterSet.has(p));
  const added = after.filter((p) => !beforeSet.has(p));
  return [
    ...removed.filter((p) => !(isIn(p, "pending") && mirrored.has(base(p)))),
    ...added.filter((p) => ownBasenames.has(base(p))),
  ];
}

const list = (dir: string): string[] => {
  const out: string[] = [];
  const visit = (d: string): void => {
    let names: string[] = [];
    try {
      names = fs.readdirSync(d);
    } catch {
      return;
    }
    for (const n of names) {
      const full = path.join(d, n);
      if (fs.lstatSync(full).isDirectory()) visit(full);
      else out.push(full);
    }
  };
  visit(dir);
  return out.sort();
};

describe("HOME marker classifier (spec 0216 delta-01)", () => {
  const own = new Set(["abc123.json"]);
  const pend = "/h/.crewrig/usage/mirror/pending/q/x.json";
  const mirr = "/h/.crewrig/usage/mirror/mirrored/q/x.json";
  test("an identical snapshot has no offender", () => {
    assert.deepEqual(classifyHomeDiff([pend], [pend], own), []);
  });
  test("a pending -> mirrored promotion is excused (scenario 4)", () => {
    assert.deepEqual(classifyHomeDiff([pend], [mirr], own), []);
  });
  test("a pending removal without a mirrored twin offends", () => {
    assert.deepEqual(classifyHomeDiff([pend], [], own), [pend]);
  });
  test("any other removal offends (scenario 3)", () => {
    const f = "/h/.crewrig/usage/journal/a.json";
    assert.deepEqual(classifyHomeDiff([f], [], own), [f]);
  });
  test("an added file offends only when the suite produced that basename (R3)", () => {
    const leak = "/h/.crewrig/usage/journal/abc123.json";
    const other = "/h/.crewrig/usage/journal/zzz.json";
    assert.deepEqual(classifyHomeDiff([], [leak, other], own), [leak]);
  });
});

describe("HOME marker live check", () => {
  test("$HOME/.crewrig/usage is unchanged by the suite", () => {
    const real = path.join(os.homedir(), ".crewrig", "usage");
    const before = list(real);
    const sb = freshSandbox();
    const r = dash(["report", "--json"], sb);
    assert.equal(r.status, 0, r.stderr.slice(0, 200));
    const own = new Set(list(sb.root).map(base));
    assert.deepEqual(classifyHomeDiff(before, list(real), own), []);
    assert.deepEqual(
      list(path.join(sb.home, ".crewrig", "usage")),
      [],
      "the temp HOME stays clean",
    );
  });
});

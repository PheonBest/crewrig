// usage-pricing-static.test.ts — the node_modules/ajv preflight, the structural group S
// (R5, R35, no-network greps) and the HOME-safety check (spec 0216) of the pricing
// suites (spec 0260, row J1a; replaces the matching parts of test-usage-pricing.sh).
// Pure fs reads plus one marker comparison: no POSIX tool is needed, so it runs on
// Windows too.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { REPO } from "./lib/worktree-fixtures.ts";
import {
  caseRoot,
  driver,
  homeLeaks,
  homeUsageMarker,
  makeCheckout,
  scratchHomeUntouched,
  type Checkout,
} from "./lib/usage-pricing-rig.ts";

const PRICE = path.join(REPO, "scripts", "lib", "usage-price");
const STORE = path.join(REPO, "scripts", "lib", "usage-store");

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : [full];
  });
}
const text = (file: string): string => fs.readFileSync(file, "utf8");
/** Lines of `file` matching `re`, as `<basename>:<n>: <line>`. */
function grep(file: string, re: RegExp): string[] {
  return text(file)
    .split("\n")
    .flatMap((l, i) => (re.test(l) ? [`${path.basename(file)}:${i + 1}: ${l}`] : []));
}

// HOME marker captured BEFORE anything runs; unreadable usage dir throws (the FATAL).
let homeBefore: string[];
let co: Checkout;
/** The rig's marker spreads one array per directory: a very large real usage root overflows the stack. */
function marker(): string[] {
  try {
    return homeUsageMarker();
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    const root = path.join(os.userInfo().homedir, ".crewrig", "usage");
    const out: string[] = [];
    const stack = [root];
    for (let d = stack.pop(); d !== undefined; d = stack.pop()) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) stack.push(full);
        else if (e.isFile()) out.push(full);
      }
    }
    return out.sort();
  }
}

before(() => {
  homeBefore = marker();
  co = makeCheckout();
});
after(() => {
  co.dispose();
});

describe("Preflight", () => {
  test("node_modules/ajv is installed (a hard assertion, never a skip)", () => {
    assert.ok(
      fs.existsSync(path.join(REPO, "node_modules", "ajv")),
      "node_modules/ajv is missing: run `npm install` first.",
    );
  });
});

describe("Structural assertions (R5, R35) + no-network grep", () => {
  const priceFiles = walk(PRICE);
  test("R35: the price tree never calls journalEntry( or wingSidecar( for writing", () => {
    const hits = priceFiles.flatMap((f) => grep(f, /journalEntry\(|wingSidecar\(/));
    assert.deepEqual(hits, []);
  });
  test("R5: the OpenRouter host string appears in exactly one file (crosscheck.js)", () => {
    const files = priceFiles.filter((f) => text(f).includes("openrouter.ai"));
    assert.deepEqual(
      files.map((f) => path.basename(f)),
      ["crosscheck.js"],
    );
  });
  test("R5: crosscheck.js is require()'d from exactly one place", () => {
    const hits = priceFiles.flatMap((f) => grep(f, /require\(.*crosscheck/));
    assert.equal(hits.length, 1, hits.join("\n"));
  });
  test("no-network grep: resolve.js, compute.js, store.js, rollup.js reach no fetch(/https?:// at all", () => {
    const hits = ["resolve.js", "compute.js", "store.js", "rollup.js"].flatMap((n) =>
      grep(path.join(PRICE, n), /fetch\(|https?:\/\//),
    );
    assert.deepEqual(hits, []);
  });
  test("no-network grep: the two appended surfaces (layout.js, prune.js) never call fetch(", () => {
    const hits = ["layout.js", "prune.js"].flatMap((n) => grep(path.join(STORE, n), /fetch\(/));
    assert.deepEqual(hits, []);
  });
});

describe("HOME safety (spec 0216): the real usage root is never written", () => {
  test("homeLeaks classification: pending to mirrored is excused, other removals and sha256 additions offend", () => {
    const h = "a".repeat(64);
    assert.deepEqual(homeLeaks(["<absent>"], ["<absent>"]), []);
    assert.deepEqual(homeLeaks(["/u/mirror/pending/x.json"], ["/u/mirror/mirrored/x.json"]), []);
    assert.equal(homeLeaks(["/u/journal/y.json"], ["<absent>"]).length, 1);
    assert.equal(homeLeaks(["<absent>"], [`/u/journal/${h}.json`]).length, 1);
    assert.deepEqual(homeLeaks(["<absent>"], ["/u/journal/unrelated.json"]), []);
  });
  test("a child run leaves the scratch HOME's usage root untouched and the real one unchanged", () => {
    const c = caseRoot();
    try {
      const r = driver(co, c, "pin", [
        path.join(REPO, "scripts", "tests", "fixtures", "usage-pricing"),
      ]);
      assert.equal(r.status, 0);
      assert.ok(scratchHomeUntouched(c));
    } finally {
      c.dispose();
    }
    assert.deepEqual(homeLeaks(homeBefore, marker()), []);
  });
});

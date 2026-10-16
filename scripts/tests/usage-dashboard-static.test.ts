// usage-dashboard-static.test.ts — case 13.17 (no daemon: the require closure of lib/usage-dashboard/*.js)
// and the static half of 13.13 (one `.listen(` with the literal '127.0.0.1') of the usage dashboard suite
// (spec 0210 R26-R30; replaces the matching groups of test-usage-dashboard.sh, spec 0260 row J1a). It reads
// the lib JS source of the tree under test (REPO honours USAGE_DASHBOARD_REPO for the mutants).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { REPO } from "./lib/usage-dashboard-rig.ts";

const DIR = path.join(REPO, "scripts", "lib", "usage-dashboard");

/** Every lib module reachable from lib/usage-dashboard/*.js through relative `require()` calls. */
function requireClosure(dir: string): string[] {
  const seen = new Set<string>();
  const stack = fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(".js"))
    .map((n) => path.join(dir, n));
  while (stack.length > 0) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    const re = /require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;
    const src = fs.readFileSync(f, "utf8");
    for (let m = re.exec(src); m !== null; m = re.exec(src)) {
      let target = path.resolve(path.dirname(f), m[1]!);
      if (!target.endsWith(".js")) target += ".js";
      if (fs.existsSync(target)) stack.push(target);
    }
  }
  return [...seen].map((f) => path.relative(REPO, f).split(path.sep).join("/")).sort();
}

describe("13.17 case_no_daemon", () => {
  const closure = requireClosure(DIR);
  test("13.17 the require closure of usage-dashboard/ never reaches usage-store/mcp.js or mirror.js", () => {
    assert.ok(closure.length > 0, "the closure is not empty");
    assert.deepEqual(
      closure.filter((f) => /usage-store\/(mcp|mirror)\.js$/.test(f)),
      [],
      `closure of ${closure.length} modules`,
    );
  });
  test("13.17 the closure reads through query.js and usage-price/store.js (R1)", () => {
    assert.ok(
      closure.some((f) => f.endsWith("usage-store/query.js")),
      closure.join("\n"),
    );
    assert.ok(
      closure.some((f) => f.endsWith("usage-price/store.js")),
      closure.join("\n"),
    );
  });
});

describe("13.13 static half", () => {
  test("13.13 server.js holds exactly one .listen( with the literal '127.0.0.1'", () => {
    const lines = fs
      .readFileSync(path.join(DIR, "server.js"), "utf8")
      .split("\n")
      .filter((l) => l.includes(".listen("));
    assert.equal(lines.length, 1, lines.join("\n"));
    assert.match(lines[0]!, /\.listen\([^)]*'127\.0\.0\.1'/);
  });
});

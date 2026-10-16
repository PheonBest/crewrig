// e2e-runner.test.ts — migrated from test-e2e-runner.sh (ADR 0003 v1 runner contract, spec 0078
// hermeticity); spec 0261 R19. Hermetic: every run writes under a throwaway E2E_REPORTS_ROOT and a
// scratch HOME; no Docker (the stand-in forbids `run`), no account.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";

import { dryRun, makeRunnerTree } from "./lib/e2e-runner-tree.ts";

const t = makeRunnerTree("crewrig-e2e-runner");
after(() => t.scratch.cleanup());

const dirsOf = (root: string): string[] =>
  fs.existsSync(root)
    ? fs
        .readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort()
    : [];

describe("runner --dry-run", () => {
  const root = path.join(t.scratch.root, "reports-dry");
  const r = dryRun(t.scratch, root, ["--dry-run"]);

  it("exits 0 in a clean environment", () => assert.equal(r.status, 0, r.stderr));

  it("creates <ts>-<rand>/ with a valid effective.json", () => {
    const dirs = dirsOf(root);
    assert.equal(dirs.length, 1, dirs.join(","));
    const file = path.join(root, dirs[0] ?? "", "effective.json");
    assert.ok(fs.existsSync(file), "effective.json missing");
    JSON.parse(fs.readFileSync(file, "utf8"));
  });

  it("prints the TAP 13 header", () => assert.match(r.stdout, /^TAP version 13$/m));

  it("prints the 1..16 plan line (7 scenarios expand to 16 (scenario,cli) pairs)", () =>
    assert.match(r.stdout, /^1\.\.16$/m));
});

describe("runner --keep", () => {
  it("--keep N retains exactly N older dirs", () => {
    const root = path.join(t.scratch.root, "reports-keep");
    const N = 3;
    for (let i = 1; i <= N + 5; i++)
      fs.mkdirSync(path.join(root, `00000000T000000Z-fake${String(i).padStart(2, "0")}`), {
        recursive: true,
      });
    const r = dryRun(t.scratch, root, ["--dry-run", "--keep", String(N)]);
    assert.equal(r.status, 0, r.stderr);
    const surviving = dirsOf(root).filter((d) => d.includes("-fake"));
    assert.equal(surviving.length, N);
  });
});

describe("runner argument errors", () => {
  it("--cli <invalid> fails with a clear message", () => {
    const r = dryRun(t.scratch, path.join(t.scratch.root, "reports-bad"), [
      "--dry-run",
      "--cli",
      "bogus",
    ]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /cli|unknown|invalid/i);
  });

  it("an unknown flag fails with a usage hint", () => {
    const r = dryRun(t.scratch, path.join(t.scratch.root, "reports-flag"), ["--no-such-flag"]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /unknown|usage/i);
  });
});

describe("runner auth gate (auth-common)", () => {
  const rd = path.join(t.scratch.root, "rd8");

  it("no credential -> SKIP unconfigured, scenario not run", () => {
    const r = t.probe(rd);
    assert.match(r.stdout, /^ok 1 - claude\/01-layered-context # SKIP unconfigured/m, r.out);
    assert.equal(fs.existsSync(path.join(rd, "claude/01-layered-context/child-env.txt")), false);
  });

  it("API key -> ready, credential path reported to the scenario", () => {
    const r = t.probe(rd, "dummy-not-a-real-key");
    assert.match(r.stdout, /^ok 1 - claude\/01-layered-context$/m, r.out);
    assert.equal(t.childVar(rd, "E2E_CREDENTIAL_PATH"), "ANTHROPIC_API_KEY");
  });
});

describe("runner default scenario set", () => {
  it("enumerates every (scenario,cli) pair: exit 0 and the 1..16 plan", () => {
    const r = dryRun(t.scratch, path.join(t.scratch.root, "reports-all"), ["--dry-run"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^1\.\.16$/m);
  });
});

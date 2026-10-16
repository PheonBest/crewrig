// windows-e2e-cases.ts — the entry cases of the Windows proof of the end-to-end harness (spec 0261
// R17, R20, R21). Each case runs `node <entry>.ts` and pins the status and the diagnostic the
// differential tests pin. Docker-driving scenarios and the live vendor probes are POSIX only (R21):
// the probes run here with NO vendor CLI on PATH, which pins only their missing-binary paths.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { REPO, check, fwd, run, scratch } from "./windows-e2e-run.ts";
import type { Ctx } from "./windows-e2e-run.ts";

const GOLDEN = path.join(
  REPO,
  "scripts/tests/fixtures/e2e-oracle/libs/toml/defaults-alone/tuple.json.golden",
);

interface Tuple {
  readonly rc: number;
  readonly stdout: string;
  readonly files: Record<string, { content: string }>;
}

/** tests/e2e/run.ts --dry-run: 16 skip lines, the TAP plan, effective.json = the toml_merge bytes. */
export function runnerDryRun(c: Ctx): void {
  const reports = scratch(c, "reports");
  c.landed.push(reports);
  const r = run(c, "tests/e2e/run.ts", ["--dry-run"], { E2E_REPORTS_ROOT: reports });
  check(c, r, (x) => {
    assert.equal(x.status, 0, "exit status");
    const lines = x.out.replaceAll("\r\n", "\n").split("\n");
    assert.equal(lines.filter((l) => /^ok \d+ - .+ # SKIP /.test(l)).length, 16, "16 skip lines");
    assert.ok(lines.includes("1..16"), "TAP plan 1..16");
    const dirs = fs.readdirSync(reports);
    assert.equal(dirs.length, 1, "one run directory");
    const effective = fs.readFileSync(path.join(reports, dirs[0] ?? "", "effective.json"), "utf8");
    const merged = run(c, "tests/e2e/lib/toml_merge.ts", [
      fwd(path.join(REPO, "tests/e2e/defaults.toml")),
    ]);
    assert.equal(merged.status, 0, "toml_merge status");
    assert.equal(effective, merged.out, "effective.json bytes equal the merge of defaults alone");
  });
}

/** toml_merge.ts as a CLI against the shell-recorded merge of defaults alone. */
export function tomlMergeCli(c: Ctx): void {
  const golden = JSON.parse(fs.readFileSync(GOLDEN, "utf8")) as Tuple;
  const dir = scratch(c, "toml");
  const file = path.join(dir, "defaults.toml");
  fs.writeFileSync(file, golden.files["defaults.toml"]?.content ?? "");
  check(c, run(c, "tests/e2e/lib/toml_merge.ts", [fwd(file)]), (x) => {
    assert.equal(x.status, golden.rc, "exit status");
    assert.equal(x.out, golden.stdout, "stdout bytes equal the shell-recorded merge");
  });
  check(c, run(c, "tests/e2e/lib/toml_merge.ts", []), (x) => {
    assert.equal(x.status, 2, "usage status");
    assert.match(x.err, /usage: .*toml_merge\.sh <defaults\.toml> \[<local\.toml>\]/);
  });
  check(c, run(c, "tests/e2e/lib/toml_merge.ts", [fwd(path.join(dir, "absent.toml"))]), (x) => {
    assert.equal(x.status, 1, "missing defaults status");
    assert.match(x.err, /ERROR: defaults file not found: /);
  });
}

/** report.ts as a CLI: a TAP directory in, the matrix and the Markdown report out. */
export function reportCli(c: Ctx): void {
  const taps = scratch(c, "taps");
  const out = scratch(c, "report-out");
  c.landed.push(taps, out);
  fs.writeFileSync(
    path.join(taps, "run.tap"),
    "TAP version 13\nok 1 - claude/01-layered-context\nnot ok 2 - gemini/01-layered-context\n" +
      "ok 3 - copilot/01-layered-context # SKIP unconfigured\n1..3\n",
  );
  check(
    c,
    run(c, "tests/e2e/lib/report.ts", ["--tap-dir", fwd(taps), "--output-dir", fwd(out)]),
    (x) => {
      assert.equal(x.status, 1, "a failing cell exits 1");
      assert.match(x.out, /01-layered-context/);
      const md = fs.readdirSync(out).filter((f) => /^parity-\d{8}-\d{6}\.md$/.test(f));
      assert.equal(md.length, 1, "one Markdown report");
    },
  );
  const empty = scratch(c, "taps-empty");
  check(c, run(c, "tests/e2e/lib/report.ts", ["--tap-dir", fwd(empty), "--dry-run"]), (x) => {
    assert.equal(x.status, 2, "an empty TAP directory exits 2");
  });
}

/** publish-probe-verdict.ts --dry-run on a fixture verdict, and its refusals. */
export function publishDryRun(c: Ctx): void {
  const dir = scratch(c, "verdict");
  fs.writeFileSync(
    path.join(dir, "verdict.json"),
    JSON.stringify({
      probe: "fixture-probe",
      verdict: "BUG-ABSENT",
      cli: "claude",
      cli_version: "1.0.0",
      run_id: "r1",
      observed_at: "2026-01-01T00:00:00Z",
    }),
  );
  const entry = "scripts/e2e/publish-probe-verdict.ts";
  check(c, run(c, entry, [fwd(dir), "--issue", "1", "--dry-run"]), (x) => {
    assert.equal(x.status, 0, "exit status");
    assert.match(x.out, /## Probe verdict — `fixture-probe`/);
    assert.match(x.out, /\*\*Verdict:\*\* `BUG-ABSENT`/);
  });
  check(c, run(c, entry, [fwd(path.join(dir, "none")), "--issue", "1", "--dry-run"]), (x) => {
    assert.equal(x.status, 1, "no verdict.json status");
    assert.match(x.err, /ERROR: no verdict\.json at /);
  });
}

/** Docker-facing entries with no docker on PATH: the diagnostic and the status. */
export function dockerless(c: Ctx): void {
  check(c, run(c, "scripts/e2e-capture-versions.ts", []), (x) => {
    assert.equal(x.status, 1, "exit status");
    assert.match(x.err, /ERROR: required image\(s\) not found locally:/);
    assert.match(x.err, /Run 'task e2e:build' first\./);
  });
  check(c, run(c, "scripts/e2e/auth-claude.ts", []), (x) => {
    assert.equal(x.status, 1, "exit status");
    // A runner may ship docker in a system directory: the entry then stops one check later, still
    // with status 1 and before any login, on the absent image.
    assert.match(
      x.err,
      /ERROR: (docker is required and was not found on \$PATH\.|image 'crewrig\/e2e-claude:latest' is not present locally\.)/,
    );
  });
}

/** The three probes with no vendor CLI on PATH: the missing-binary diagnostics and statuses. */
export function probesWithoutCli(c: Ctx): void {
  check(c, run(c, "scripts/probe-extension-hooks.ts", []), (x) => {
    assert.equal(x.status, 1, "exit status");
    const names = ["claude", "gemini", "agy", "copilot"];
    const want = names.map((n) => `ERROR: '${n}' not found in PATH.`);
    assert.deepEqual(
      x.err
        .replaceAll("\r\n", "\n")
        .split("\n")
        .filter((l) => l.startsWith("ERROR:")),
      want,
    );
  });
  check(c, run(c, "scripts/probe-antigravity-discovery.ts", []), (x) => {
    assert.equal(x.status, 1, "exit status");
    assert.match(x.err, /ERROR: 'agy' not found in PATH\. This probe needs the vendor binary\./);
  });
  check(c, run(c, "scripts/probe-extension-mcp-token.ts", []), (x) => {
    assert.equal(x.status, 2, "exit status");
    for (const tool of ["copilot", "agy", "claude"])
      assert.match(x.out, new RegExp(`SKIP: ${tool} not on PATH`));
  });
}

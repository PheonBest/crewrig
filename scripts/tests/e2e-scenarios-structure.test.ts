// e2e-scenarios-structure.test.ts — migrated from test-e2e-scenarios-structure.sh (issue #80,
// ADR 0005 Decision 3); spec 0261 R19. The executable-bit, `bash -n` and `source "$E2E_LIB_DIR"`
// checks are requirement-14 shell-text assertions and are dropped. The duplicate-mount guard drives
// the runner against the Docker stand-in and reads the recorded `docker run` argv.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";

import {
  makeScratch,
  put,
  readToml,
  REPO,
  runEntry,
  sandboxEnv,
  slashed,
} from "./lib/e2e-suite-kit.ts";

const SCENARIOS = [
  "01-layered-context",
  "02-cross-tool-memory",
  "03-skill-build",
  "04-harness-loop",
  "05-copilot-model-routing",
  "06-agent-surface-consumption",
  "07-guidance-surface",
];
const SCEN_DIR = path.join(REPO, "tests/e2e/scenarios");

describe("scenario directories", () => {
  for (const s of SCENARIOS) {
    it(`scenario '${s}' — directory and run.ts exist`, () => {
      assert.ok(fs.statSync(path.join(SCEN_DIR, s)).isDirectory());
      assert.ok(fs.existsSync(path.join(SCEN_DIR, s, "run.ts")), "run.ts missing");
    });
  }

  it("scenarios/README.md is present and non-empty", () => {
    assert.ok(fs.statSync(path.join(SCEN_DIR, "README.md")).size > 0);
  });

  it("defaults.toml declares a [scenarios.<name>] table for every scenario", () => {
    const scenarios = readToml("tests/e2e/defaults.toml")["scenarios"] as Record<string, unknown>;
    for (const s of SCENARIOS) assert.ok(s in scenarios, `no [scenarios.${s}] table`);
  });
});

const s = makeScratch("crewrig-e2e-structure");
after(() => s.cleanup());
let n = 0;

/** Drive `run.ts --scenario --cli` against the stand-in; returns the recorded docker argv records. */
function driveCase(scenario: string, cli: string): { status: number | null; runs: string[][] } {
  n += 1;
  const dir = path.join(s.root, `c${n}`);
  const bundle = path.join(dir, "e2e-root", ".crewrig-e2e", cli);
  put(path.join(bundle, "00-rules.md"), "# Location: Nantes\n");
  put(path.join(bundle, ".credentials.json"), '{"dummy":true}\n');
  const fixtures = path.join(dir, "state", "f.json");
  put(
    fixtures,
    JSON.stringify({
      [`${scenario}/${cli}`]: Array.from({ length: 5 }, () => ({
        match: ["run"],
        stdout: "Nantes",
      })),
    }),
  );
  const log = path.join(dir, "state", "log.jsonl");
  put(log, "");
  const env = sandboxEnv(s, {
    CREWRIG_E2E_HOME: path.join(dir, "e2e-root"),
    E2E_REPORTS_ROOT: path.join(dir, "reports"),
    LC_ALL: "C",
    ANTHROPIC_API_KEY: "d",
    GEMINI_API_KEY: "d",
    COPILOT_GITHUB_TOKEN: "d",
    E2E_JUDGE_MOCK: "1",
    E2E_JUDGE_MOCK_RESPONSE: "VERDICT=PASS CONF=0.95",
    E2E_STANDIN_FIXTURES: fixtures,
    E2E_STANDIN_CASE: `${scenario}/${cli}`,
    E2E_STANDIN_STATE: path.join(dir, "state", "c"),
    E2E_STANDIN_LOG: log,
  });
  fs.mkdirSync(path.join(dir, "state", "c"), { recursive: true });
  const r = runEntry(
    path.join(REPO, "tests/e2e/run.ts"),
    [
      "--scenario",
      scenario,
      "--cli",
      cli,
      "--report-dir",
      path.join(dir, "reports", "20000101T000000Z-0000"),
    ],
    env,
  );
  const runs = fs
    .readFileSync(log, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => (JSON.parse(l) as { argv: string[] }).argv)
    .filter((a) => a[0] === "run");
  return { status: r.status, runs };
}

/** Container paths mounted more than once with different host/mode strings in one argv. */
function conflictingMounts(argv: readonly string[]): string[] {
  const byContainer = new Map<string, Set<string>>();
  argv.forEach((a, i) => {
    if (a !== "-v") return;
    const bind = slashed(argv[i + 1] ?? "").replace(/\/+/g, "/");
    const parts = bind.split(":");
    const container = parts.length > 2 && /^[A-Za-z]$/.test(parts[0] ?? "") ? parts[2] : parts[1];
    if (container === undefined) return;
    (byContainer.get(container) ?? byContainer.set(container, new Set()).get(container))?.add(bind);
  });
  return [...byContainer].filter(([, v]) => v.size > 1).map(([k]) => k);
}

// Duplicate-mount guard (PLAN v2 step 19): docker exits 125 "Duplicate mount point" when one container
// path is bound twice with different host/mode strings. A byte-identical repeat is the tolerated case.
describe("duplicate-mount guard on the recorded docker argv", () => {
  for (const pair of [
    "01-layered-context:claude",
    "01-layered-context:gemini",
    "01-layered-context:copilot",
    "06-agent-surface-consumption:copilot",
    "06-agent-surface-consumption:claude",
    "07-guidance-surface:claude",
  ]) {
    const [scenario = "", cli = ""] = pair.split(":");
    it(`scenario '${scenario}' [${cli}] — no conflicting duplicate -v container path`, () => {
      const { status, runs } = driveCase(scenario, cli);
      assert.ok(runs.length >= 1, `no docker run recorded (rc=${status})`);
      for (const argv of runs) assert.deepEqual(conflictingMounts(argv), []);
    });
  }
});

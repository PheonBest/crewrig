// e2e-scenario-06-differential.test.ts — scenario 06 (probe B) through `node tests/e2e/run.ts` on canned
// container outputs (spec 0261 R7), in a scratch tree under the Docker stand-in: the richer fixtures reach
// the consumed, not-consumed and indeterminate verdicts. The shell leg is removed with run.sh.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { writeLauncher, type FixtureEntry } from "./lib/e2e-docker-standin.ts";
import { REPO_ROOT } from "./lib/e2e-oracle-observe.ts";

const NODE_FLAG = "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON";
const SCENARIO = "06-agent-surface-consumption";
const RUN_ID = "20000101T000000Z-0000";
const WS = "/home/agent/workspace/.claude/agents";
const NESTED = `${WS}/probe-consumer/AGENT.md`;
const FLAT = `${WS}/probe-consumer.md`;
const CROSS = "/home/agent/.copilot/agents/probe-consumer.md";

const BASELINE = "{{ARG_MATCH:(crewrig-probe-b-baseline-[0-9a-f]+)}}";
const agentNonce = (file: string): string => `{{FILE_MATCH:${file}::(crewrig-probe-b-[0-9a-f]+)}}`;

const RUN = { match: ["run"] } as const;
const version = (cli: string, extra: Partial<FixtureEntry> = {}): FixtureEntry => ({
  ...RUN,
  stdout: `${cli} 9.9.9\n`,
  ...extra,
});
const baselineFile = { "/out/baseline.txt": BASELINE };

const copilotConsumed = (file: string): FixtureEntry => ({
  ...RUN,
  stdout: `● Probe-consumer(sonnet) probe\n  └ ${agentNonce(file)}\n`,
  files: baselineFile,
});
const copilotNotConsumed = (): FixtureEntry => ({
  ...RUN,
  stdout: "● Probe-consumer(sonnet) probe\n  └ Agent completed but produced no response.\n",
  files: baselineFile,
});
const copilotNoSpawn = (): FixtureEntry => ({ ...RUN, stdout: "done\n", files: baselineFile });

function claudeJson(stats: string, result: string): string {
  return JSON.stringify({
    result,
    subagent_stats: { by_type: { "probe-consumer": JSON.parse(stats) as unknown } },
    modelUsage: { "claude-sonnet-4-6": {} },
  });
}
const claudeConsumed = (file: string): FixtureEntry => ({
  ...RUN,
  stdout: claudeJson('{"spawned":1,"completed":1,"errored":0}', agentNonce(file)),
  files: baselineFile,
});
const claudeStats = (stats: string, result = "ok"): FixtureEntry => ({
  ...RUN,
  stdout: claudeJson(stats, result),
  files: baselineFile,
});

interface Case {
  readonly name: string;
  readonly cli: "copilot" | "claude";
  readonly fixtures: readonly FixtureEntry[];
  readonly env?: Readonly<Record<string, string>>;
}

const cases: readonly Case[] = [
  {
    name: "copilot: every cell consumed",
    cli: "copilot",
    fixtures: [
      version("copilot"),
      copilotConsumed(NESTED),
      copilotConsumed(FLAT),
      copilotConsumed(CROSS),
    ],
  },
  {
    name: "copilot: nested not consumed fills the contradicts array and the cross reference",
    cli: "copilot",
    fixtures: [
      version("copilot"),
      copilotNotConsumed(),
      copilotConsumed(FLAT),
      copilotConsumed(CROSS),
    ],
  },
  {
    name: "copilot: no spawn marker, baseline written",
    cli: "copilot",
    fixtures: [version("copilot"), copilotNoSpawn(), copilotNoSpawn(), copilotNoSpawn()],
  },
  {
    name: "copilot: baseline only in stdout, consumed.txt forged by the session",
    cli: "copilot",
    fixtures: [
      version("copilot"),
      {
        ...RUN,
        stdout: `${BASELINE}\n● Probe-consumer(sonnet) probe\n  └ Agent completed but produced no response.\n`,
        files: { "/out/consumed.txt": agentNonce(NESTED) },
      },
      copilotNotConsumed(),
      copilotConsumed(CROSS),
    ],
  },
  {
    name: "copilot: version call fails after one line",
    cli: "copilot",
    fixtures: [
      version("copilot", { stdout: "copilot 1.2.3\nmore\n", exit: 3 }),
      copilotNotConsumed(),
      copilotNotConsumed(),
      copilotNotConsumed(),
    ],
  },
  {
    name: "copilot: version without a trailing newline",
    cli: "copilot",
    fixtures: [
      version("copilot", { stdout: "copilot 4.5.6", exit: 1 }),
      copilotNotConsumed(),
      copilotNotConsumed(),
      copilotNotConsumed(),
    ],
  },
  {
    name: "copilot: docker fails on a cell, empty version, evidence truncated mid character",
    cli: "copilot",
    fixtures: [
      version("copilot", { stdout: "" }),
      {
        ...RUN,
        stdout: `a${"é".repeat(200)}\u0001\u007f\n`,
        stderr: "boom\nsecond line\n",
        exit: 2,
      },
      copilotNotConsumed(),
      copilotConsumed(CROSS),
    ],
  },
  {
    name: "claude: both cells consumed",
    cli: "claude",
    fixtures: [version("claude"), claudeConsumed(NESTED), claudeConsumed(FLAT)],
  },
  {
    name: "claude: spawned but never answered, then never spawned",
    cli: "claude",
    fixtures: [
      version("claude"),
      claudeStats('{"spawned":1,"completed":0,"errored":0}'),
      claudeStats('{"spawned":0,"completed":0,"errored":0}'),
    ],
  },
  {
    name: "claude: an errored spawn does not count as a response",
    cli: "claude",
    fixtures: [
      version("claude"),
      claudeStats('{"spawned":1,"completed":1,"errored":1}', agentNonce(NESTED)),
      claudeConsumed(FLAT),
    ],
  },
  {
    name: "claude: docker exits non-zero in the second cell",
    cli: "claude",
    fixtures: [
      version("claude"),
      claudeConsumed(NESTED),
      { ...RUN, stdout: "", stderr: "crash\n", exit: 125 },
    ],
  },
  {
    name: "claude: a missing credential skips before any docker call",
    cli: "claude",
    fixtures: [],
    env: { ANTHROPIC_API_KEY: "" },
  },
];

interface Leg {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly docker: string[][];
  readonly files: Record<string, string>;
}

function walk(dir: string, found: Record<string, string>, base: string): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, found, base);
    else if (e.isFile() && e.name !== "effective.json") {
      const buf = fs.readFileSync(full);
      if (!buf.includes(0)) found[path.relative(base, full)] = buf.toString("latin1");
    }
  }
}

function runLeg(_kind: "entry", c: Case): Leg {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "e2e-s06-diff-")));
  try {
    fs.cpSync(path.join(REPO_ROOT, "tests", "e2e"), path.join(root, "tests", "e2e"), {
      recursive: true,
      filter: (src) => !src.includes(`${path.sep}tests${path.sep}e2e${path.sep}reports`),
    });
    fs.rmSync(path.join(root, "tests/e2e/local.toml"), { force: true });
    fs.symlinkSync(path.join(REPO_ROOT, "scripts"), path.join(root, "scripts"));
    fs.symlinkSync(path.join(REPO_ROOT, "node_modules"), path.join(root, "node_modules"));
    const home = path.join(root, "home");
    const bundleRoot = path.join(root, "e2e-root");
    const bin = path.join(root, "bin");
    const state = path.join(root, "standin");
    const tmp = path.join(root, "tmp");
    for (const d of [home, path.join(bundleRoot, ".crewrig-e2e"), bin, state, tmp])
      fs.mkdirSync(d, { recursive: true });
    writeLauncher(bin);
    const key = `${SCENARIO}/${c.cli}`;
    fs.writeFileSync(path.join(state, "fixtures.json"), JSON.stringify({ [key]: c.fixtures }));
    const log = path.join(state, "log.jsonl");
    const reportDir = path.join(root, "reports", RUN_ID);
    const env: Record<string, string> = {
      PATH: `${bin}${path.delimiter}${process.env["PATH"] ?? ""}`,
      HOME: home,
      CREWRIG_E2E_HOME: bundleRoot,
      E2E_REPORTS_ROOT: path.join(root, "reports"),
      TMPDIR: tmp,
      LC_ALL: "C",
      ANTHROPIC_API_KEY: "dummy-anthropic-key",
      COPILOT_GITHUB_TOKEN: "dummy-copilot-token",
      E2E_STANDIN_FIXTURES: path.join(state, "fixtures.json"),
      E2E_STANDIN_CASE: key,
      E2E_STANDIN_STATE: path.join(state, "counters"),
      E2E_STANDIN_LOG: log,
      ...c.env,
    };
    const args = ["--scenario", SCENARIO, "--cli", c.cli, "--report-dir", reportDir];
    const run = path.join(root, "tests/e2e", "run.ts");
    const [cmd, argv] = [process.execPath, [NODE_FLAG, run, ...args]];
    const res = spawnSync(cmd as string, argv as string[], {
      cwd: root,
      env,
      encoding: "utf8",
      timeout: 120_000,
    });
    const norm = (s: string): string =>
      s
        .split(root)
        .join("<ROOT>")
        .replace(/crewrig-probe-b-(baseline-)?[0-9a-f]{16}/g, "crewrig-probe-b-$1<NONCE>")
        .replace(/crewrig-e2e-(probe-b|copilot-home)\.[A-Za-z0-9]{6}/g, "crewrig-e2e-$1.<RAND>")
        .replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ/g, "<TS>");
    const found: Record<string, string> = {};
    if (fs.existsSync(reportDir)) walk(reportDir, found, reportDir);
    const files = Object.fromEntries(
      Object.entries(found)
        .map(([k, v]): [string, string] => [norm(k), norm(v)])
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
    const docker = fs.existsSync(log)
      ? fs
          .readFileSync(log, "utf8")
          .split("\n")
          .filter((l) => l !== "")
          .map((l) => (JSON.parse(l) as { argv: string[] }).argv.map(norm))
      : [];
    return {
      status: res.status ?? -1,
      stdout: norm(res.stdout),
      stderr: norm(res.stderr),
      docker,
      files,
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe("scenario 06 (probe B): entry on canned container outputs", () => {
  it("the richer fixtures reach consumed, not-consumed and indeterminate", () => {
    const outcomes = new Set<string>();
    for (const c of [cases[0], cases[1], cases[6]] as Case[]) {
      const tap = runLeg("entry", c).files[`${c.cli}/${SCENARIO}/scenario.tap`] ?? "";
      for (const m of tap.matchAll(/: (consumed|not-consumed|indeterminate)$/gm)) {
        outcomes.add(m[1] as string);
      }
    }
    assert.deepEqual([...outcomes].sort(), ["consumed", "indeterminate", "not-consumed"]);
  });
});

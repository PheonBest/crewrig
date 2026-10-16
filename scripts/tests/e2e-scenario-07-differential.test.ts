// e2e-scenario-07-differential.test.ts — scenario 07-guidance-surface (probe C, spec 0203) through
// `bash tests/e2e/run.sh` and `node tests/e2e/run.ts` side by side, on cases richer than the
// recorded goldens: a seeded local.toml for the Copilot BYOK cases, and Docker stand-in fixtures
// that echo what the scenario asked (`{{ARGV_LAST}}`, `{{ARG_MATCH:<regex>}}`) so that the
// DISTURBED and INDETERMINATE verdict paths are reachable. Each leg runs in its own scratch tree
// (tests/e2e copied without reports/, scripts/ and node_modules symlinked); exit status, stdout,
// stderr, docker argv and every text file of the report directory must agree byte for byte once
// nonces, scratch paths and timestamps are normalised. The HONOURED and IGNORED verdicts need the
// agent nonce, which lives only in a mounted file the stand-in cannot read: not reachable here.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { writeLauncher, type FixtureEntry } from "./lib/e2e-docker-standin.ts";
import { REPO_ROOT, shellPrerequisites } from "./lib/e2e-oracle-observe.ts";

const NODE_FLAG = "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON";
const SCENARIO = "07-guidance-surface";
const RUN_ID = "20000101T000000Z-0000";
const BASELINE = "{{ARG_MATCH:(crewrig-probe-c-base-[0-9a-f]+)}}";

const BYOK = 'byok_provider = "ollama"\nbyok_model = "glm-5.3-flash:cloud"\n';
const WRAPPED = `[cli.copilot]\n${BYOK}command = ["copilot", "--wrapped"]\ncommand_args = ["--extra"]\n`;

interface Case {
  readonly name: string;
  readonly cli: "claude" | "copilot";
  readonly local?: string;
  readonly fixtures: readonly FixtureEntry[];
  /** What the scenario.tap must contain, proving the verdict path was reached. */
  readonly tap: RegExp;
}

const RUN = { match: ["run"] };
const version = (stdout: string, exit = 0): FixtureEntry => ({ ...RUN, stdout, exit });
const stats = (spawned: number, completed: number, errored: number, model: string): string =>
  JSON.stringify({
    result: `${BASELINE} done`,
    subagent_stats: { by_type: { "probe-guidance": { spawned, completed, errored } } },
    modelUsage: { [model]: {} },
  });
const cell = (stdout: string, extra: Partial<FixtureEntry> = {}): FixtureEntry => ({
  ...RUN,
  stdout,
  ...extra,
});

const CASES: readonly Case[] = [
  {
    name: "claude: both legs answer, nonce missing (INDETERMINATE)",
    cli: "claude",
    fixtures: [
      version("claude 1.2.3\nsecond line\n"),
      cell(stats(1, 1, 0, "claude-sonnet-4-6")),
      cell(stats(1, 1, 0, "claude-haiku-4-5")),
    ],
    tap: /C3 \(claude\): INDETERMINATE \[target-nonce-missing\]/,
  },
  {
    name: "claude: the guided subagent errors (DISTURBED)",
    cli: "claude",
    fixtures: [
      version("claude 1.2.3\n"),
      cell(stats(1, 1, 0, "claude-sonnet-4-6")),
      cell(stats(1, 0, 1, "claude-sonnet-4-6")),
    ],
    tap: /C3 \(claude\): DISTURBED \[guidance-caused-failure\]/,
  },
  {
    name: "claude: baseline written to /out/baseline.txt only, no spawn",
    cli: "claude",
    fixtures: [
      version("claude 1.2.3\n"),
      cell('{"result":"ok"}', { files: { "/out/baseline.txt": "{{ARGV_LAST}}" } }),
      cell('{"result":"ok"}', { files: { "/out/baseline.txt": "{{ARGV_LAST}}" } }),
    ],
    tap: /C3 \(claude\): DISTURBED \[guidance-caused-failure\]/,
  },
  {
    name: "claude: the version call fails after one line",
    cli: "claude",
    fixtures: [
      version("partial\n", 3),
      cell(stats(1, 1, 0, "claude-sonnet-4-6")),
      cell(stats(1, 1, 0, "claude-sonnet-4-6")),
    ],
    tap: /C3 \(claude\): INDETERMINATE/,
  },
  {
    name: "copilot: BYOK declared but the command is unchanged (skip)",
    cli: "copilot",
    local: `[cli.copilot]\n${BYOK}`,
    fixtures: [],
    tap: /^1\.\.0 # SKIP byok_provider='ollama' declared but/,
  },
  {
    name: "copilot: wrapper in force, prose names an unserved model (C1 and C2 DISTURBED)",
    cli: "copilot",
    local: `${WRAPPED}mounts = ["\${CREWRIG_E2E_HOME}/ollama:/run/ollama-creds:ro", "\${HOME}/x:/x"]\nenv_keys = ["OLLAMA_HOST"]\n`,
    fixtures: [
      version("copilot 0.0.1\n"),
      cell("Error: Model sonnet not found\n{{ARGV_LAST}}", { exit: 1 }),
      cell("{{ARGV_LAST}}", { stderr: "Invalid model: effort\n", exit: 1 }),
    ],
    tap: /C1 \(copilot\): DISTURBED \[prose-disturbs-routing\]\nok 2 - C2 \(copilot\): DISTURBED \[effort-frontmatter-disturbs-routing\]/,
  },
  {
    name: "copilot: spawn answered, no symptom (INDETERMINATE)",
    cli: "copilot",
    local: WRAPPED,
    fixtures: [
      version("copilot 0.0.1"),
      cell("● probe-guidance(sonnet) probe\n  └ replied\n{{ARGV_LAST}}"),
      cell(
        "● probe-guidance(sonnet) probe\n  └ Agent completed but produced no response.\n{{ARGV_LAST}}",
      ),
    ],
    tap: /C1 \(copilot\): INDETERMINATE \[no-discriminating-observation\]/,
  },
  {
    name: "copilot: unknown baseline (session broken)",
    cli: "copilot",
    local: WRAPPED,
    fixtures: [version("copilot 0.0.1\n"), cell(""), cell("")],
    tap: /C2 \(copilot\): INDETERMINATE \[session-broken-or-unresponsive\]/,
  },
];

interface Leg {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly docker: string[][];
  readonly files: Record<string, string>;
}

function readFiles(root: string, norm: (s: string) => string): Record<string, string> {
  const found: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name !== "effective.json") {
        found[path.relative(root, full)] = norm(fs.readFileSync(full, "utf8"));
      }
    }
  };
  if (fs.existsSync(root)) walk(root);
  return Object.fromEntries(Object.entries(found).sort(([a], [b]) => (a < b ? -1 : 1)));
}

function runLeg(kind: "shell" | "entry", c: Case): Leg {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "e2e-s07-diff-")));
  try {
    fs.cpSync(path.join(REPO_ROOT, "tests", "e2e"), path.join(root, "tests", "e2e"), {
      recursive: true,
      filter: (src) => !src.includes(`${path.sep}tests${path.sep}e2e${path.sep}reports`),
    });
    fs.symlinkSync(path.join(REPO_ROOT, "scripts"), path.join(root, "scripts"));
    fs.symlinkSync(path.join(REPO_ROOT, "node_modules"), path.join(root, "node_modules"));
    fs.rmSync(path.join(root, "tests/e2e/local.toml"), { force: true });
    if (c.local !== undefined) fs.writeFileSync(path.join(root, "tests/e2e/local.toml"), c.local);

    const bin = path.join(root, "bin");
    const state = path.join(root, "standin");
    const tmp = path.join(root, "tmp");
    const home = path.join(root, "home");
    const bundleRoot = path.join(root, "e2e-root");
    for (const d of [bin, state, tmp, home, path.join(bundleRoot, ".crewrig-e2e")]) {
      fs.mkdirSync(d, { recursive: true });
    }
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
    };
    const args = ["--scenario", SCENARIO, "--cli", c.cli, "--report-dir", reportDir];
    const run = path.join(root, "tests/e2e", kind === "shell" ? "run.sh" : "run.ts");
    const [cmd, argv] =
      kind === "shell" ? ["bash", [run, ...args]] : [process.execPath, [NODE_FLAG, run, ...args]];
    const res = spawnSync(cmd as string, argv as string[], { cwd: root, env, encoding: "utf8" });
    const norm = (s: string): string =>
      s
        .split(root)
        .join("<ROOT>")
        .replace(/crewrig-probe-c-(base-)?[0-9a-f]{16}\b/g, "crewrig-probe-c-$1<NONCE>")
        .replace(/(crewrig-e2e-probe-c)\.[A-Za-z0-9]{6}\b/g, "$1.<RAND>")
        .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/g, "<TS>");
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
      files: readFiles(reportDir, norm),
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const skip = shellPrerequisites() ?? false;

describe("scenario 07-guidance-surface: shell and entry agree", { skip }, () => {
  for (const c of CASES) {
    it(c.name, () => {
      const shell = runLeg("shell", c);
      const entry = runLeg("entry", c);
      assert.deepEqual(entry, shell);
      const tap = entry.files[path.join(c.cli, SCENARIO, "scenario.tap")] ?? "";
      assert.match(tap, c.tap);
    });
  }
});

// e2e-scenario-05-differential.test.ts — scenario 05 (probe A) through BOTH legs, shell and entry,
// on richer paths than the recorded goldens (which only prove the skip paths): the Docker stand-in
// echoes the nonce each run asked for (`{{FILE_MATCH}}`, `{{ARG_MATCH}}`), so the BUG-ABSENT,
// BUG-PRESENT, hint-inert and fallback-control verdicts are reachable. Each leg gets a scratch copy
// of tests/e2e (no reports/), symlinked scripts/ and node_modules, and a local.toml declaring the
// BYOK pair and a copilot command. Nonces are normalised to <NONCE>. Skipped where the shell runner
// cannot run (bash >= 4, jq, yq).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { writeLauncher } from "./lib/e2e-docker-standin.ts";
import { REPO_ROOT, shellPrerequisites } from "./lib/e2e-oracle-observe.ts";

const NODE_FLAG = "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON";
const RUN_ID = "20000101T000000Z-0000";
const KEY = "05-copilot-model-routing/copilot";
const DECL = "/home/agent/workspace/.claude/agents/probe-router/AGENT.md";
const FB_DECL = "/home/agent/.copilot/agents/probe-router.md";
const NONCE_RE = "(crewrig-probe-[0-9a-f]+)";
const NO_RESPONSE = "Agent completed but produced no response.";

const LOCAL = `[cli.copilot]
command       = ["copilot", "--api-key=sekret-value", "--wrapper"]
byok_provider = "ollama-cloud"
byok_model    = "glm-test"
`;
const LOCAL_UNBACKED = `[cli.copilot]
byok_provider = "ollama-cloud"
byok_model    = "glm-test"
`;

const echoed = (decl: string): string =>
  `● Probe-router(sonnet)\n  └ {{FILE_MATCH:${decl}::${NONCE_RE}}}\n`;
const silent = `● Probe-router(sonnet)\n  └ ${NO_RESPONSE}\n`;
const version = { stdout: "GitHub Copilot CLI 9.9.9\nsecond line\n" };

interface Fx {
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exit?: number;
  readonly files?: Record<string, string>;
}
const leg = (stdout: string, extra: Partial<Fx> = {}): Fx => ({ stdout, ...extra });

interface Result {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly docker: string[][];
  readonly files: Record<string, string>;
}

function walk(dir: string, root: string, out: Record<string, string>): void {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, root, out);
    else if (e.name !== "effective.json") {
      out[path.relative(root, full).split(path.sep).join("/")] = fs.readFileSync(full, "utf8");
    }
  }
}

function runLeg(kind: "shell" | "entry", local: string, fixtures: Fx[]): Result {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "e2e-s05-diff-")));
  try {
    fs.cpSync(path.join(REPO_ROOT, "tests", "e2e"), path.join(root, "tests", "e2e"), {
      recursive: true,
      filter: (src) => !src.includes(`${path.sep}tests${path.sep}e2e${path.sep}reports`),
    });
    fs.symlinkSync(path.join(REPO_ROOT, "scripts"), path.join(root, "scripts"));
    fs.symlinkSync(path.join(REPO_ROOT, "node_modules"), path.join(root, "node_modules"));
    fs.writeFileSync(path.join(root, "tests/e2e/local.toml"), local);
    const bin = path.join(root, "bin");
    const state = path.join(root, "standin");
    for (const d of [bin, state, path.join(root, "home"), path.join(root, "tmp")]) {
      fs.mkdirSync(d, { recursive: true });
    }
    writeLauncher(bin);
    const table = path.join(state, "fixtures.json");
    fs.writeFileSync(table, JSON.stringify({ [KEY]: fixtures }));
    const log = path.join(state, "log.jsonl");
    const bundle = path.join(root, "e2e-root");
    const reports = path.join(root, "reports");
    const env = {
      PATH: `${bin}${path.delimiter}${process.env["PATH"] ?? ""}`,
      HOME: path.join(root, "home"),
      CREWRIG_E2E_HOME: bundle,
      E2E_REPORTS_ROOT: reports,
      TMPDIR: path.join(root, "tmp"),
      LC_ALL: "C",
      COPILOT_GITHUB_TOKEN: "dummy-copilot-token",
      E2E_JUDGE_MOCK: "1",
      E2E_STANDIN_FIXTURES: table,
      E2E_STANDIN_CASE: KEY,
      E2E_STANDIN_STATE: path.join(state, "counters"),
      E2E_STANDIN_LOG: log,
    };
    const reportDir = path.join(reports, RUN_ID);
    const args = ["--scenario", "05-copilot-model-routing", "--cli", "copilot"];
    const run = path.join(root, "tests/e2e", kind === "shell" ? "run.sh" : "run.ts");
    const [cmd, argv] =
      kind === "shell"
        ? ["bash", [run, ...args, "--report-dir", reportDir]]
        : [process.execPath, [NODE_FLAG, run, ...args, "--report-dir", reportDir]];
    const res = spawnSync(cmd as string, argv as string[], { cwd: root, env, encoding: "utf8" });
    const norm = (s: string): string =>
      s
        .split(root)
        .join("<ROOT>")
        .replace(/crewrig-probe-[0-9a-f]{16}/g, "<NONCE>")
        .replace(/(crewrig-e2e-(?:probe-a(?:-fallback)?|copilot-home))\.[A-Za-z0-9]{6}/g, "$1.X")
        .replace(/"observed_at": "[^"]+"/g, '"observed_at": "<T>"');
    const files: Record<string, string> = {};
    walk(reportDir, reportDir, files);
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
      files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, norm(v)])),
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const skip = shellPrerequisites() ?? false;

describe("scenario 05: shell and entry agree", { skip }, () => {
  const cases: Array<{
    name: string;
    local: string;
    fixtures: Fx[];
    verdict?: string;
    status?: number;
  }> = [
    {
      name: "BUG-ABSENT: control and model-bearing echo the nonce, efficacy fails loudly",
      local: LOCAL,
      verdict: "BUG-ABSENT",
      fixtures: [
        version,
        leg(echoed(DECL), { files: { "/out/leg.txt": `{{FILE_MATCH:${DECL}::${NONCE_RE}}}` } }),
        leg(silent, { stderr: "HTTP 404 model not found on provider\n" }),
        leg(echoed(DECL)),
      ],
    },
    {
      name: "BUG-PRESENT: the model-bearing leg shows the symptom",
      local: LOCAL,
      verdict: "BUG-PRESENT",
      fixtures: [version, leg(echoed(DECL)), leg(silent, { stderr: "HTTP 404\n" }), leg(silent)],
    },
    {
      name: "hint inert: the efficacy leg echoes the nonce",
      local: LOCAL,
      verdict: "INDETERMINATE",
      fixtures: [version, leg(echoed(DECL)), leg(echoed(DECL)), leg(silent)],
    },
    {
      name: "control silent, fallback layout observed (escalation note)",
      local: LOCAL,
      verdict: "INDETERMINATE",
      fixtures: [
        version,
        leg(silent),
        leg(silent),
        leg(silent),
        leg(echoed(FB_DECL), { exit: 3, stderr: "{{ARG_MATCH:--name (\\S+)}} {{ARGV_LAST}}\n" }),
      ],
    },
    {
      name: "docker run failing everywhere",
      local: LOCAL,
      fixtures: [
        { exit: 1, stderr: "boom\n" },
        leg("", { exit: 1 }),
        leg("", { exit: 1 }),
        leg("", { exit: 1 }),
        leg("", { exit: 1 }),
      ],
    },
    {
      name: "declared but the command is unchanged: skip",
      local: LOCAL_UNBACKED,
      fixtures: [],
      status: 78,
    },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const shell = runLeg("shell", c.local, c.fixtures);
      const entry = runLeg("entry", c.local, c.fixtures);
      assert.deepEqual(entry, shell);
      if (c.status !== undefined) {
        assert.match(
          entry.files["copilot/05-copilot-model-routing/scenario.tap"] ?? "",
          /# SKIP .*unchanged from the defaults-only merge/,
        );
      }
      if (c.verdict !== undefined) {
        const verdict = JSON.parse(
          entry.files["copilot/05-copilot-model-routing/verdict.json"] ?? "{}",
        ) as {
          verdict?: string;
        };
        assert.equal(verdict.verdict, c.verdict);
      }
    });
  }
});

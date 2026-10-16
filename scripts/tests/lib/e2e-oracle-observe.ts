// e2e-oracle-observe.ts — run the end-to-end runner for ONE (scenario, cli) pair against the Docker
// stand-in and describe what it did as a normalised `Tuple` (spec 0261 R5, R7, R8).
//
// The subject is `shell` (`bash tests/e2e/run.sh`), `entry` (`node tests/e2e/run.ts`) or `auto`
// (the entry when the file exists, else the shell). The child gets a whitelisted environment: a
// scratch HOME / CREWRIG_E2E_HOME / TMPDIR / reports root, `LC_ALL=C`, dummy credentials, the
// stand-in scratch bin FIRST on PATH, and E2E_JUDGE_MOCK=1; CI and NODE_TEST_CONTEXT never reach
// it. The report directory is named like a run id so the normaliser maps container names and paths
// to placeholders. POSIX only. Never reaches a container engine or an account.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { writeLauncher } from "./e2e-docker-standin.ts";
import { normalise, normaliseArgv, type NormaliseContext } from "./e2e-normalise.ts";
import type { OracleCase, Tuple } from "./e2e-oracle-types.ts";
import { findTool } from "./hermetic-env.ts";

export type Subject = "shell" | "entry" | "auto";

export const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
export const RUN_ENTRY = path.join(REPO_ROOT, "tests", "e2e", "run.ts");
export const RUN_SHELL = path.join(REPO_ROOT, "tests", "e2e", "run.sh");
/** A fixed run-id-shaped directory name, so container names and paths normalise stably. */
const RUN_ID = "20000101T000000Z-0000";
const NODE_FLAG = "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON";

export function resolveSubject(subject: Subject): "shell" | "entry" {
  if (subject === "auto") return fs.existsSync(RUN_ENTRY) ? "entry" : "shell";
  return subject;
}

/** A skip reason when the shell harness cannot run on this host, else null. */
export function shellPrerequisites(): string | null {
  if (process.platform === "win32") return "the shell harness needs a POSIX host";
  const bash = findTool("bash");
  if (bash === undefined) return "bash is missing";
  const probe = spawnSync(bash, ["-c", "printf %s ${BASH_VERSINFO[0]}"], { encoding: "utf8" });
  const major = Number(probe.stdout);
  if (!(major >= 4)) return `bash >= 4 is required (found ${probe.stdout || "unknown"})`;
  for (const tool of ["jq", "yq"]) if (findTool(tool) === undefined) return `${tool} is missing`;
  return null;
}

function isText(buf: Buffer): boolean {
  return !buf.includes(0);
}

function collectFiles(root: string, ctx: NormaliseContext): Record<string, string> {
  const found: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "build-work") walk(full);
      } else if (entry.isFile() && !(dir === root && entry.name === "effective.json")) {
        const buf = fs.readFileSync(full);
        if (isText(buf)) {
          found[path.relative(root, full).split(path.sep).join("/")] = normalise(
            buf.toString("utf8"),
            ctx,
          );
        }
      }
    }
  };
  if (fs.existsSync(root)) walk(root);
  return Object.fromEntries(Object.entries(found).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

function readLog(file: string): string[][] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => (JSON.parse(line) as { argv: string[] }).argv);
}

export function observe(c: OracleCase, subject: Subject = "auto"): Tuple {
  const leg = resolveSubject(subject);
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "e2e-oracle-")));
  try {
    const home = path.join(root, "home");
    const bundleRoot = path.join(root, "e2e-root");
    const e2eHome = path.join(bundleRoot, ".crewrig-e2e");
    const reportDir = path.join(root, "reports", RUN_ID);
    const bin = path.join(root, "bin");
    const state = path.join(root, "standin");
    const tmp = path.join(root, "tmp");
    for (const dir of [home, e2eHome, bin, state, tmp]) fs.mkdirSync(dir, { recursive: true });
    writeLauncher(bin);
    for (const [tool, text] of Object.entries(c.stubTools ?? {})) {
      fs.writeFileSync(path.join(bin, tool), text, { mode: 0o755 });
    }
    const fixtures = path.join(state, "fixtures.json");
    const key = `${c.scenario}/${c.cli}`;
    fs.writeFileSync(fixtures, JSON.stringify({ [key]: c.fixtures }));
    const logFile = path.join(state, "log.jsonl");
    c.seed?.({ cli: c.cli, home, e2eHome, reportDir });

    const env: Record<string, string> = {
      PATH: `${bin}${path.delimiter}${process.env["PATH"] ?? ""}`,
      HOME: home,
      CREWRIG_E2E_HOME: bundleRoot,
      E2E_REPORTS_ROOT: path.join(root, "reports"),
      TMPDIR: tmp,
      LC_ALL: "C",
      ANTHROPIC_API_KEY: "dummy-anthropic-key",
      GEMINI_API_KEY: "dummy-gemini-key",
      COPILOT_GITHUB_TOKEN: "dummy-copilot-token",
      E2E_JUDGE_MOCK: "1",
      E2E_JUDGE_MOCK_RESPONSE: c.judgeMockResponse ?? "",
      E2E_STANDIN_FIXTURES: fixtures,
      E2E_STANDIN_CASE: key,
      E2E_STANDIN_STATE: path.join(state, "counters"),
      E2E_STANDIN_LOG: logFile,
      ...c.env,
    };
    delete env["CI"];
    delete env["NODE_TEST_CONTEXT"];

    const args = ["--scenario", c.scenario, "--cli", c.cli, "--report-dir", reportDir];
    const [cmd, argv] =
      leg === "entry"
        ? [process.execPath, [NODE_FLAG, RUN_ENTRY, ...args]]
        : ["bash", [RUN_SHELL, ...args]];
    const run = spawnSync(cmd, argv, {
      cwd: REPO_ROOT,
      env,
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024,
    });

    const ctx: NormaliseContext = { tmp: root, home, e2eHome };
    const tapFile = path.join(reportDir, c.cli, c.scenario, "scenario.tap");
    return {
      id: c.id,
      exit: run.status ?? -1,
      scenarioTap: fs.existsSync(tapFile) ? normalise(fs.readFileSync(tapFile, "utf8"), ctx) : "",
      dockerCommands: readLog(logFile).map((a) => normaliseArgv(a, ctx)),
      files: collectFiles(reportDir, ctx),
      stdout: normalise(run.stdout ?? "", ctx),
      stderr: normalise(run.stderr ?? "", ctx),
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** The golden text of a tuple: 2-space JSON, stable key order, trailing LF. */
export function serialise(tuple: Tuple): string {
  return `${JSON.stringify(tuple, null, 2)}\n`;
}

/** Golden path of a case under `root`: `<root>/<scenario>/<cli>/<variant>/tuple.json.golden`. */
export function goldenPath(root: string, c: OracleCase): string {
  return path.join(root, c.scenario, c.cli, c.variant, "tuple.json.golden");
}

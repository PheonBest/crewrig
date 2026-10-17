// e2e-runner-tree.ts — a scratch copy of tests/e2e/ whose 01-layered-context scenario is a
// recorder, so a runner suite observes the environment the runner hands its scenario child
// (spec 0261 R12, R19). The scripts directory is linked in, never copied.

import fs from "node:fs";
import path from "node:path";

import {
  makeScratch,
  put,
  REPO,
  runEntry,
  sandboxEnv,
  type RunResult,
  type Scratch,
} from "./e2e-suite-kit.ts";

const RECORDER = `import { writeFileSync } from "node:fs";
import { join } from "node:path";
const vars = ["E2E_LIB_DIR", "E2E_REPORT_DIR", "E2E_CLI", "E2E_IMAGE", "E2E_EFFECTIVE_JSON",
  "E2E_SCENARIO_DIR", "E2E_CREDENTIAL_PATH", "E2E_CREWRIG_E2E_HOME"];
const out = vars.map((v) => \`\${v}=\${process.env[v] ?? ""}\\n\`).join("");
writeFileSync(join(process.env.E2E_REPORT_DIR ?? ".", "child-env.txt"), out);
process.exit(0);
`;

export interface RunnerTree {
  readonly scratch: Scratch;
  readonly tree: string;
  /** Run the scratch runner for claude/01-layered-context into `reportDir`, with an optional API key. */
  readonly probe: (reportDir: string, apiKey?: string) => RunResult;
  /** A value the scenario child saw, from `<reportDir>/claude/01-layered-context/child-env.txt`. */
  readonly childVar: (reportDir: string, name: string) => string;
}

export function makeRunnerTree(prefix: string): RunnerTree {
  const scratch = makeScratch(prefix);
  const tree = path.join(scratch.root, "tree");
  fs.mkdirSync(path.join(tree, "tests"), { recursive: true });
  fs.cpSync(path.join(REPO, "tests/e2e"), path.join(tree, "tests/e2e"), { recursive: true });
  fs.rmSync(path.join(tree, "tests/e2e/reports"), { recursive: true, force: true });
  fs.symlinkSync(path.join(REPO, "scripts"), path.join(tree, "scripts"), "junction");
  if (fs.existsSync(path.join(REPO, "node_modules"))) {
    fs.symlinkSync(path.join(REPO, "node_modules"), path.join(tree, "node_modules"), "junction");
  }
  put(path.join(tree, "tests/e2e/scenarios/01-layered-context/run.ts"), RECORDER);
  const e2eHome = path.join(scratch.root, "e2ehome");
  fs.mkdirSync(e2eHome, { recursive: true });
  return {
    scratch,
    tree,
    probe(reportDir, apiKey) {
      fs.rmSync(reportDir, { recursive: true, force: true });
      const env = sandboxEnv(scratch, {
        CREWRIG_E2E_HOME: e2eHome,
        E2E_REPORTS_ROOT: path.join(scratch.root, "reports"),
        E2E_STANDIN_FORBID_RUN: "1",
        E2E_STANDIN_LOG: path.join(scratch.root, "standin.log"),
        ...(apiKey === undefined ? {} : { ANTHROPIC_API_KEY: apiKey }),
      });
      return runEntry(
        path.join(tree, "tests/e2e/run.ts"),
        ["--scenario", "01-layered-context", "--cli", "claude", "--report-dir", reportDir],
        env,
      );
    },
    childVar(reportDir, name) {
      const file = path.join(reportDir, "claude/01-layered-context/child-env.txt");
      const line = fs
        .readFileSync(file, "utf8")
        .split("\n")
        .find((l) => l.startsWith(`${name}=`));
      return line === undefined ? "" : line.slice(name.length + 1);
    },
  };
}

/** A bare dry-run of the real runner into a throwaway reports root. */
export function dryRun(scratch: Scratch, reportsRoot: string, args: readonly string[]): RunResult {
  const env = sandboxEnv(scratch, {
    CREWRIG_E2E_HOME: path.join(scratch.root, "e2ehome"),
    E2E_REPORTS_ROOT: reportsRoot,
  });
  return runEntry(path.join(REPO, "tests/e2e/run.ts"), args, env);
}

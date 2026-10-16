// e2e-runner-differential.test.ts — `bash tests/e2e/run.sh` and `node tests/e2e/run.ts` side by side
// (spec 0261 R1-R4, R7): same exit status, stdout, stderr, effective.json bytes and report tree for
// the usage errors, --dry-run (with and without a local.toml), --keep pruning and a missing-credential
// skip. Each leg runs in its own scratch copy of tests/e2e and scripts/e2e/lib; run ids and scratch
// paths are normalised. Skipped where the shell runner cannot run (bash >= 4, jq, yq).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { REPO_ROOT, shellPrerequisites } from "./lib/e2e-oracle-observe.ts";

const NODE_FLAG = "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON";
const LOCAL_TOML = '[scenarios.01-layered-context]\napplies_to = ["claude"]\n';

interface Leg {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly effective: string[];
  readonly tree: string[];
}

function tree(dir: string): string[] {
  const found: string[] = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      found.push(path.relative(dir, full));
      if (e.isDirectory()) walk(full);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return found.sort();
}

function runLeg(kind: "shell" | "entry", args: string[], local: boolean, seed: string[]): Leg {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "e2e-runner-diff-")));
  try {
    fs.cpSync(path.join(REPO_ROOT, "tests", "e2e"), path.join(root, "tests", "e2e"), {
      recursive: true,
      filter: (src) => !src.includes(`${path.sep}tests${path.sep}e2e${path.sep}reports`),
    });
    fs.cpSync(path.join(REPO_ROOT, "scripts", "e2e", "lib"), path.join(root, "scripts/e2e/lib"), {
      recursive: true,
    });
    fs.rmSync(path.join(root, "tests/e2e/local.toml"), { force: true });
    if (local) fs.writeFileSync(path.join(root, "tests/e2e/local.toml"), LOCAL_TOML);
    const reports = path.join(root, "reports");
    fs.mkdirSync(path.join(root, "home"), { recursive: true });
    fs.mkdirSync(reports);
    for (const name of seed) fs.mkdirSync(path.join(reports, name));
    const env = {
      PATH: process.env["PATH"] ?? "",
      HOME: path.join(root, "home"),
      CREWRIG_E2E_HOME: path.join(root, "home"),
      E2E_REPORTS_ROOT: reports,
      TMPDIR: root,
      LC_ALL: "C",
    };
    const run = path.join(root, "tests/e2e", kind === "shell" ? "run.sh" : "run.ts");
    const [cmd, argv] =
      kind === "shell" ? ["bash", [run, ...args]] : [process.execPath, [NODE_FLAG, run, ...args]];
    const res = spawnSync(cmd as string, argv as string[], { cwd: root, env, encoding: "utf8" });
    const norm = (s: string): string =>
      s
        .split(root)
        .join("<ROOT>")
        .replace(/\d{8}T\d{6}Z-[0-9a-f]{4}/g, "<RUNID>")
        .replace(/\/tmp\.[A-Za-z0-9]{10}\b/g, "/tmp.X");
    const effective = tree(reports)
      .filter((f) => f.endsWith("effective.json"))
      // yq >= 4.4x prints the float literal `0.0`, the recorded yq printed `0`: not the runner's concern.
      .map((f) => fs.readFileSync(path.join(reports, f), "utf8").replace(/: 0\.0,/g, ": 0,"));
    return {
      status: res.status ?? -1,
      stdout: norm(res.stdout),
      stderr: norm(res.stderr),
      effective,
      tree: tree(reports).map(norm),
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const skip = shellPrerequisites() ?? false;

describe("e2e runner: shell and entry agree", { skip }, () => {
  const cases: Array<{ name: string; args: string[]; local?: boolean; seed?: string[] }> = [
    { name: "--help", args: ["--help"] },
    { name: "unknown flag", args: ["--bogus"] },
    { name: "bad --cli", args: ["--cli", "nope"] },
    { name: "bad --report", args: ["--report", "json"] },
    { name: "unknown scenario", args: ["--scenario", "nope", "--dry-run"] },
    { name: "--dry-run", args: ["--dry-run"] },
    { name: "--dry-run with local.toml", args: ["--dry-run"], local: true },
    {
      name: "--dry-run filtered",
      args: ["--dry-run", "--scenario", "03-skill-build", "--cli", "gemini"],
    },
    {
      name: "--keep prunes old report dirs",
      args: ["--dry-run", "--keep", "2"],
      seed: ["20200101T000000Z-aaaa", "20210101T000000Z-bbbb", "20220101T000000Z-cccc"],
    },
    { name: "missing credential skips", args: ["--cli", "claude"] },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const shell = runLeg("shell", c.args, c.local ?? false, c.seed ?? []);
      const entry = runLeg("entry", c.args, c.local ?? false, c.seed ?? []);
      assert.deepEqual(entry, shell);
    });
  }

  it("--dry-run emits the 16 skips, the plan and the summary", () => {
    const entry = runLeg("entry", ["--dry-run"], false, []);
    assert.equal(entry.status, 0);
    assert.equal(entry.stdout.split("\n").filter((l) => l.includes("# SKIP")).length, 16);
    assert.match(entry.stdout, /^1\.\.16$/m);
    assert.match(entry.stdout, /^# pass: 0 {2}fail: 0 {2}skip: 16$/m);
  });
});

// e2e-probes-scenarios.test.ts — the scenario-driving half of scripts/tests/test-e2e-probes.sh (spec
// 0261 R11, R17): probe A/B/C entries (`tests/e2e/scenarios/*/run.ts`), the runner (`tests/e2e/run.ts`)
// against the Docker stand-in, and `publish-probe-verdict.ts --dry-run`. No Docker, no account, no
// credit. Overlap note: e2e-runner-differential and e2e-scenario-0[567]-differential assert the same
// entries against recorded goldens; the assertions here are the literal expectations.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const NODE = ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON"];
const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "probes-scn-")));
after(() => fs.rmSync(base, { recursive: true, force: true }));
let n = 0;

interface Drive {
  dir: string;
  log: string[][];
  report: string;
  bundle: string;
  rc: number | null;
}

function drive(scenario: string, cli: string, stdout = "x", seed = ""): Drive {
  const dir = path.join(base, `c${++n}`);
  const bundle = path.join(dir, "e2e-root", ".crewrig-e2e", cli);
  for (const d of ["home", "bin", "state", "tmp"])
    fs.mkdirSync(path.join(dir, d), { recursive: true });
  spawnSync(process.execPath, [
    ...NODE,
    path.join(REPO, "scripts/tests/lib/e2e-docker-standin.ts"),
    "--write-launcher",
    path.join(dir, "bin"),
  ]);
  if (seed !== "absent-bundle") {
    fs.mkdirSync(bundle, { recursive: true });
    fs.writeFileSync(path.join(bundle, "00-rules.md"), "# Location: Nantes\n");
    fs.writeFileSync(path.join(bundle, ".credentials.json"), '{"dummy":true}\n');
  }
  if (seed === "loose-modes") {
    fs.mkdirSync(path.join(bundle, "sub"));
    fs.chmodSync(path.join(bundle, "sub"), 0o755);
    fs.chmodSync(path.join(bundle, ".credentials.json"), 0o644);
  }
  const fixtures = {
    [`${scenario}/${cli}`]: Array.from({ length: 5 }, () => ({ match: ["run"], stdout })),
  };
  fs.writeFileSync(path.join(dir, "state", "f.json"), JSON.stringify(fixtures));
  const tree = path.join(dir, "tree");
  fs.mkdirSync(path.join(tree, "tests"), { recursive: true });
  fs.cpSync(path.join(REPO, "tests", "e2e"), path.join(tree, "tests", "e2e"), { recursive: true });
  fs.rmSync(path.join(tree, "tests/e2e/reports"), { recursive: true, force: true });
  fs.rmSync(path.join(tree, "tests/e2e/local.toml"), { force: true });
  fs.symlinkSync(path.join(REPO, "scripts"), path.join(tree, "scripts"));
  if (fs.existsSync(path.join(REPO, "node_modules")))
    fs.symlinkSync(path.join(REPO, "node_modules"), path.join(tree, "node_modules"));
  if (seed.startsWith("local")) {
    const cmd =
      seed === "local-secret"
        ? '["copilot", "--token=sk-xyz-secret"]'
        : '["copilot", "--byok-stand-in"]';
    fs.writeFileSync(
      path.join(tree, "tests/e2e/local.toml"),
      `[cli.copilot]\ncommand = ${cmd}\nenv_keys = ["COPILOT_GITHUB_TOKEN"]\nbyok_provider = "ollama-cloud"\nbyok_model = "glm-5.3-flash:cloud"\n`,
    );
  }
  const reportRoot = path.join(dir, "reports", "20000101T000000Z-0000");
  const log = path.join(dir, "state", "log.jsonl");
  const res = spawnSync(
    process.execPath,
    [...NODE, "tests/e2e/run.ts", "--scenario", scenario, "--cli", cli, "--report-dir", reportRoot],
    {
      cwd: tree,
      encoding: "utf8",
      env: {
        PATH: `${path.join(dir, "bin")}:${process.env["PATH"]}`,
        HOME: path.join(dir, "home"),
        CREWRIG_E2E_HOME: path.join(dir, "e2e-root"),
        E2E_REPORTS_ROOT: path.join(dir, "reports"),
        TMPDIR: path.join(dir, "tmp"),
        LC_ALL: "C",
        ANTHROPIC_API_KEY: "d",
        GEMINI_API_KEY: "d",
        COPILOT_GITHUB_TOKEN: "d",
        E2E_JUDGE_MOCK: "1",
        E2E_JUDGE_MOCK_RESPONSE: "VERDICT=PASS CONF=0.95",
        E2E_STANDIN_FIXTURES: path.join(dir, "state", "f.json"),
        E2E_STANDIN_CASE: `${scenario}/${cli}`,
        E2E_STANDIN_STATE: path.join(dir, "state", "c"),
        E2E_STANDIN_LOG: log,
      },
    },
  );
  const lines = fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").filter(Boolean) : [];
  const rec = lines.map((l) => (JSON.parse(l) as { argv: string[] }).argv);
  return { dir, log: rec, report: path.join(reportRoot, cli, scenario), bundle, rc: res.status };
}

const clean = (p: string) => p.replace(/\/+/g, "/");
const mode = (p: string) => (fs.statSync(p).mode & 0o777).toString(8);
const mountOf = (d: Drive, sub: string): string | undefined => {
  for (const argv of d.log) {
    if (!argv.some((x) => x.includes(sub))) continue;
    for (let i = 0; i < argv.length - 1; i++) {
      const spec = argv[i + 1]?.split(":") ?? [];
      if (argv[i] === "-v" && spec[1] === "/home/agent/.copilot") return clean(spec[0] ?? "");
    }
  }
  return undefined;
};
interface Verdict {
  effective_command: unknown;
  credential_path: string;
  cells: { observable: { spawn_observed: boolean; nonce_observed: boolean } }[];
}
const verdict = (d: Drive): Verdict =>
  JSON.parse(fs.readFileSync(path.join(d.report, "verdict.json"), "utf8")) as Verdict;

describe("probe B and runner argv (effective config, R12)", () => {
  test("06/copilot: recorded argv carries command, env keys and mounts of the effective config", () => {
    const d = drive("06-agent-surface-consumption", "copilot");
    const eff = JSON.parse(
      fs.readFileSync(path.join(path.dirname(path.dirname(d.report)), "effective.json"), "utf8"),
    ) as { cli: { copilot: { command: string[]; env_keys: string[]; mounts: string[] } } };
    const runs = d.log.filter((a) => a[1] === "--rm");
    assert.ok(runs.some((a) => a.includes(eff.cli.copilot.command[0]) && a.includes("-p")));
    for (const k of eff.cli.copilot.env_keys)
      assert.ok(
        runs.some((a) => a.some((x, i) => x === "-e" && a[i + 1] === k)),
        `env ${k}`,
      );
    for (const m of eff.cli.copilot.mounts as string[]) {
      const t = m.split(":")[1] as string;
      assert.ok(
        runs.some((a) =>
          a.some((x) => x.endsWith(`:${t}:rw`) || x.endsWith(`:${t}:ro`) || x.endsWith(`:${t}`)),
        ),
        `mount ${t}`,
      );
    }
  });
  test("v2-F4: probe A row-1 fallback and probe B cell 3 mount a scratch ephemeral home, never the bundle", () => {
    for (const [scn, seed, sub] of [
      ["05-copilot-model-routing", "local", "05-fallback"],
      ["06-agent-surface-consumption", "", "cross_cell_control"],
    ] as const) {
      const d = drive(scn, "copilot", "x", seed);
      const host = mountOf(d, sub);
      assert.ok(host, `${sub}: mount present`);
      const bundle = clean(d.bundle);
      assert.ok(host !== bundle && !host.startsWith(`${bundle}/`), "not the persisted bundle");
      assert.ok(!host.startsWith(`${clean(d.dir)}/reports/`), "not in the report tree");
      assert.ok(host.startsWith(`${clean(d.dir)}/tmp/`), "under the scratch TMPDIR");
    }
  });
  test("R5: the runner creates an absent bundle at 700 and restores 700/600 after the scenario", () => {
    const a = drive("06-agent-surface-consumption", "copilot", "x", "absent-bundle");
    assert.equal(mode(a.bundle), "700");
    assert.equal(mode(path.dirname(a.bundle)), "700");
    const l = drive("06-agent-surface-consumption", "copilot", "x", "loose-modes");
    assert.equal(mode(path.join(l.bundle, "sub")), "700");
    assert.equal(mode(path.join(l.bundle, ".credentials.json")), "600");
  });
});

describe("verdict content", () => {
  test("probe A masks the effective_command and records the runner's credential_path (v2-F3, fix 2)", () => {
    const d = drive("05-copilot-model-routing", "copilot", "x", "local-secret");
    const v = verdict(d);
    const cmd = JSON.stringify(v.effective_command);
    assert.ok(cmd.includes("token=***") && !cmd.includes("sk-xyz-secret"), cmd);
    assert.equal(v.credential_path, "COPILOT_GITHUB_TOKEN");
  });
  test("probe B credits the CLI spawn marker from subagent_stats but never the nonce from it", () => {
    const stats =
      '{"result":"done","subagent_stats":{"by_type":{"probe-consumer":{"spawned":1,"completed":1,"errored":0}}},"modelUsage":{"claude-sonnet-4-6":{}}}';
    const v = verdict(drive("06-agent-surface-consumption", "claude", stats));
    assert.ok(
      v.cells.every(
        (c: { observable: { spawn_observed: boolean } }) => c.observable.spawn_observed,
      ),
    );
    assert.ok(
      v.cells.every(
        (c: { observable: { nonce_observed: boolean } }) => !c.observable.nonce_observed,
      ),
    );
  });
});

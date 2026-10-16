// e2e-probes-publisher.test.ts — probe skip path (78) and publish-probe-verdict.ts --dry-run, the
// remaining half of scripts/tests/test-e2e-probes.sh (spec 0261 R11, R17). No Docker, no account.

// e2e-probes-publisher.test.ts — the skip-path and publisher half of scripts/tests/test-e2e-probes.sh (spec
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

describe("skip path (78) and verdict publisher", () => {
  const runProbe = (scn: string, cli: string, eff: unknown) => {
    const dir = fs.mkdtempSync(path.join(base, "skip-"));
    const effective = path.join(dir, "effective.json");
    fs.writeFileSync(effective, JSON.stringify(eff));
    const res = spawnSync(
      process.execPath,
      [...NODE, path.join(REPO, "tests/e2e/scenarios", scn, "run.ts")],
      {
        cwd: REPO,
        encoding: "utf8",
        env: {
          PATH: process.env["PATH"] ?? "",
          HOME: dir,
          TMPDIR: dir,
          E2E_LIB_DIR: path.join(REPO, "tests/e2e/lib"),
          E2E_REPORT_DIR: dir,
          E2E_CLI: cli,
          E2E_IMAGE: "fake:latest",
          E2E_EFFECTIVE_JSON: effective,
          E2E_CREWRIG_E2E_HOME: path.join(dir, "h"),
          E2E_SCENARIO_DIR: path.join(REPO, "tests/e2e/scenarios", scn),
          E2E_RUN_ID: "test",
        },
      },
    );
    return { rc: res.status, verdict: fs.existsSync(path.join(dir, "verdict.json")) };
  };
  const base0 = {
    image: "crewrig/e2e-copilot:latest",
    command: ["copilot"],
    command_args: [],
    mounts: [],
    env_keys: ["COPILOT_GITHUB_TOKEN"],
  };
  test("probe A skips with 78 and no verdict when byok_* is absent, unbacked, or the CLI is not copilot", () => {
    assert.deepEqual(runProbe("05-copilot-model-routing", "copilot", { cli: { copilot: base0 } }), {
      rc: 78,
      verdict: false,
    });
    const unbacked = {
      cli: {
        copilot: { ...base0, byok_provider: "ollama-cloud", byok_model: "deepseek-v4-pro:cloud" },
      },
    };
    assert.deepEqual(runProbe("05-copilot-model-routing", "copilot", unbacked), {
      rc: 78,
      verdict: false,
    });
    assert.equal(
      runProbe("05-copilot-model-routing", "claude", { cli: { copilot: base0 } }).rc,
      78,
    );
  });
  test("probe C skips with 78 for an unsupported CLI (gemini)", () => {
    assert.equal(runProbe("07-guidance-surface", "gemini", { cli: { copilot: base0 } }).rc, 78);
  });
  const render = (verdictDoc: unknown, issue: string) => {
    const dir = fs.mkdtempSync(path.join(base, "pub-"));
    fs.writeFileSync(path.join(dir, "verdict.json"), JSON.stringify(verdictDoc));
    const r = spawnSync(
      process.execPath,
      [
        ...NODE,
        path.join(REPO, "scripts/e2e/publish-probe-verdict.ts"),
        dir,
        "--issue",
        issue,
        "--dry-run",
      ],
      { encoding: "utf8", cwd: REPO },
    );
    return r.stdout + r.stderr;
  };
  test("--dry-run renders probe A, B and C shaped verdicts", () => {
    const aOut = render(
      {
        probe: "05-copilot-model-routing",
        spec: "0194",
        run_id: "t",
        observed_at: "2026-09-02T00:00:00Z",
        verdict: "BUG-PRESENT",
        reason: null,
        cli: "copilot",
        cli_version: "1.0.51",
        declared_provider: "ollama-cloud",
        declared_model: "m",
        effective_command: ["bash", "-c", "x", "sh"],
        credential_path: "COPILOT_GITHUB_TOKEN",
        surface: ".claude/agents/",
        layout: "nested",
        legs: {
          control_no_hint: { model_value: null, nonce_observed: true, evidence: "x" },
          hint_efficacy: { model_value: "m", nonce_observed: false, evidence: "x" },
          model_bearing: { model_value: "sonnet", nonce_observed: false, evidence: "x" },
        },
        upstream_issue: "github/copilot-cli#4437",
      },
      "1103",
    );
    for (const f of ["hint_efficacy", "surface", "effective_command", "BUG-PRESENT"])
      assert.ok(aOut.includes(f), f);
    const bOut = render(
      {
        probe: "06-agent-surface-consumption",
        spec: "0194",
        run_id: "t",
        observed_at: "2026-09-02T00:00:00Z",
        cells: [
          { cli: "copilot", layout: "nested", outcome: "not-consumed" },
          { cli: "claude", layout: "flat", outcome: "consumed" },
        ],
        contradicts: ["specs/0143-copilot-subagent-model-fallback.md -> ## Intent"],
      },
      "1103",
    );
    for (const f of ["not-consumed", "consumed", "Contradicts", "specs/0143"])
      assert.ok(bOut.includes(f), f);
    const cOut = render(
      {
        probe: "07-guidance-surface",
        spec: "0203",
        run_id: "t",
        observed_at: "2026-09-09T00:00:00Z",
        cells: [
          {
            cell: "C1",
            cli: "copilot",
            outcome: "IGNORED",
            reason: "prose-inert-subagent-responded",
          },
          { cell: "C3", cli: "claude", outcome: "HONOURED", reason: "requested-model-selected" },
        ],
      },
      "1113",
    );
    for (const f of [
      "07-guidance-surface",
      "C1 (copilot)",
      "IGNORED",
      "prose-inert",
      "C3 (claude)",
      "HONOURED",
    ])
      assert.ok(cOut.includes(f), f);
  });
});

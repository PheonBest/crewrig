// e2e-probes-resolvers.test.ts — the pure-library half of scripts/tests/test-e2e-probes.sh (spec 0261
// R11, R17): probe A/B/C resolver truth tables, command masking, spawn-marker detection and the two
// toml files. Overlap note: the recorded goldens in e2e-oracle-libs.test.ts cover the same inputs
// differentially; these tests keep the literal expected verdicts, so they survive the shell's removal.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { maskCommandJson, maskCommandString } from "../../tests/e2e/lib/mask_command.ts";
import { resolveProbeA } from "../../tests/e2e/lib/probe_a_resolve.ts";
import { resolveProbeBCell } from "../../tests/e2e/lib/probe_b_resolve.ts";
import {
  resolveProbeC1,
  resolveProbeC2,
  resolveProbeC3,
  resolveProbeC4,
} from "../../tests/e2e/lib/probe_c_resolve.ts";
import { probeSpawnSignals } from "../../tests/e2e/lib/probe_spawn_markers.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const LIB = "tests/e2e/lib/x.sh";
const FIXTURES = path.join(REPO, "scripts", "tests", "fixtures", "probe-a-transcripts");
const a = (...v: string[]) => resolveProbeA(v, LIB).stdout.trim();
const b = (...v: string[]) => resolveProbeBCell(v, LIB).stdout.trim();

describe("probe A resolver truth table", () => {
  test("rows 1-2 and the v2-F1 uncorroborated rows", () => {
    assert.equal(
      a("false", "false", "false", "false", "false"),
      "INDETERMINATE|surface-not-read-or-session-broken",
    );
    assert.equal(
      a("true", "true", "false", "false", "false"),
      "INDETERMINATE|hint-inert-trigger-not-armed",
    );
    assert.equal(
      a("true", "false", "false", "true", "false"),
      "INDETERMINATE|efficacy-leg-failed-unexplained",
    );
    assert.equal(
      a("true", "false", "false", "false", "true"),
      "INDETERMINATE|efficacy-leg-failed-unexplained",
    );
  });
  test("BUG-ABSENT / BUG-PRESENT / no-discriminating-observation need a corroborated efficacy absence", () => {
    assert.equal(a("true", "false", "true", "true", "false"), "BUG-ABSENT|");
    assert.equal(a("true", "false", "true", "false", "true"), "BUG-PRESENT|");
    assert.equal(
      a("true", "false", "true", "false", "false"),
      "INDETERMINATE|no-discriminating-observation",
    );
  });
  test("BUG-ABSENT is unreachable while the efficacy nonce is observed (all 3 remaining booleans)", () => {
    for (const s of ["true", "false"])
      for (const bear of ["true", "false"])
        for (const bs of ["true", "false"])
          assert.ok(!a("true", "true", s, bear, bs).startsWith("BUG-ABSENT"), `${s}/${bear}/${bs}`);
  });
  test("a missing argument is a nounset abort (127)", () => {
    assert.equal(resolveProbeA(["true"], LIB).rc, 127);
  });
});

describe("probe B resolver (R12)", () => {
  test("outcome vocabulary", () => {
    assert.equal(b("true", "true"), "consumed");
    assert.equal(b("true", "false"), "consumed");
    assert.equal(b("false", "true"), "not-consumed");
    assert.equal(b("false", "false"), "indeterminate");
  });
});

describe("probe C resolvers", () => {
  const out = (r: { stdout: string }) => r.stdout.trim();
  test("C1 and C2", () => {
    assert.equal(
      out(resolveProbeC1(["true", "true", "true", "false"], LIB)),
      "IGNORED|prose-inert-subagent-responded",
    );
    assert.equal(
      out(resolveProbeC1(["true", "false", "false", "true"], LIB)),
      "DISTURBED|prose-disturbs-routing",
    );
    assert.equal(
      out(resolveProbeC1(["false", "false", "false", "false"], LIB)),
      "INDETERMINATE|session-broken-or-unresponsive",
    );
    assert.equal(
      out(resolveProbeC2(["true", "true", "true", "false"], LIB)),
      "IGNORED|effort-frontmatter-inert",
    );
    assert.equal(
      out(resolveProbeC2(["true", "false", "false", "true"], LIB)),
      "DISTURBED|effort-frontmatter-disturbs-routing",
    );
  });
  test("C3 and C4 guidance", () => {
    assert.equal(
      out(resolveProbeC3(["true", "true", "true", "haiku", "haiku", "sonnet"], LIB)),
      "HONOURED|requested-model-selected",
    );
    assert.equal(
      out(resolveProbeC3(["true", "true", "true", "sonnet", "haiku", "sonnet"], LIB)),
      "IGNORED|session-or-default-model-selected",
    );
    assert.equal(
      out(resolveProbeC3(["true", "false", "false", "", "haiku", "sonnet"], LIB)),
      "DISTURBED|guidance-caused-failure",
    );
    const m = ["gemini-3.8-flash-low", "gemini-3.8-flash-low", "gemini-3.8-flash-high"];
    assert.equal(
      out(resolveProbeC4(["true", "true", "true", ...m], LIB)),
      "HONOURED|requested-model-selected",
    );
  });
});

describe("command masking (v2-F3)", () => {
  test("flag-style secret is masked, other argv untouched", () => {
    const got = maskCommandString("ollama launch copilot --api-key=sk-abc123 --yes");
    assert.ok(got.includes("--api-key=***") && !got.includes("sk-abc123"));
    assert.match(got, /ollama launch copilot.*--yes/);
  });
  test("a quoted value with a space is fully masked", () => {
    const got = maskCommandString('OLLAMA_API_KEY="sk secret withspace" ollama serve');
    assert.ok(got.includes("OLLAMA_API_KEY=***"));
    assert.ok(!got.includes("secret withspace") && !got.includes("sk secret"));
  });
  test("an assignment right after an opening quote is masked", () => {
    const got = maskCommandString('bash -c "OLLAMA_MODELS=/tmp/x ollama launch copilot"');
    assert.ok(got.includes("OLLAMA_MODELS=***") && !got.includes("/tmp/x"));
  });
  test("the json form keeps element count and order, including a literal -c, and leaks nothing", () => {
    const input = ["bash", "-c", 'OLLAMA_API_KEY="sk secret" ollama serve --api-key=sk-xyz', "sh"];
    const r = maskCommandJson(JSON.stringify(input));
    const out = JSON.parse(r.stdout) as string[];
    assert.equal(out.length, input.length);
    assert.equal(out[1], "-c");
    assert.ok(!r.stdout.includes("sk secret") && !r.stdout.includes("sk-xyz"));
  });
});

describe("spawn markers (issue #1107 fix 1)", () => {
  const sig = (file: string, agent: string, nonce: string) =>
    probeSpawnSignals(file, agent, nonce, REPO).trim();
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(process.env["TMPDIR"] ?? "/tmp"), "spawn-"));
  const put = (name: string, body: string) => {
    const f = path.join(tmp, name);
    fs.writeFileSync(f, body);
    return f;
  };
  test("genuine success leg is credited; both orchestrator-forged legs are not", () => {
    assert.equal(
      sig(
        path.join(FIXTURES, "control-no-hint.stdout"),
        "Probe-router",
        "crewrig-probe-de91a90702907b2b",
      ),
      "true|true|true|glm-5.3-flash:cloud",
    );
    assert.equal(
      sig(
        path.join(FIXTURES, "hint-efficacy.stdout"),
        "Probe-router",
        "crewrig-probe-0bc218c9d711cabe",
      ),
      "true|false|false|crewrig-probe-no-such-model",
    );
    assert.equal(
      sig(
        path.join(FIXTURES, "model-bearing.stdout"),
        "Probe-router",
        "crewrig-probe-7ca75a2dc6b32083",
      ),
      "true|false|false|sonnet",
    );
  });
  test("a nonce elsewhere in the transcript is not credited", () => {
    const f = put(
      "synth",
      "✗ Probe-router(sonnet) Nonce emission probe leg\n  └ Agent completed but produced no response.\n\nI found its declared nonce: crewrig-probe-SYNTHETIC-ELSEWHERE\n\n● Write leg.txt (shell)\n  │ printf 'crewrig-probe-SYNTHETIC-ELSEWHERE' > /out/leg.txt\n  └ 1 line written\n",
    );
    assert.equal(
      sig(f, "Probe-router", "crewrig-probe-SYNTHETIC-ELSEWHERE"),
      "true|false|false|sonnet",
    );
  });
  test("a missing transcript resolves to all-false", () => {
    assert.equal(sig(path.join(tmp, "absent"), "Probe-router", "x"), "false|false|false|");
  });
  test("Claude Code JSON telemetry: success, unspawned, errored", () => {
    const stats = (spawned: number, completed: number, errored: number, result: string) =>
      JSON.stringify({
        result,
        modelUsage: { "claude-3-7-sonnet-20250219": {} },
        subagent_stats: {
          by_type: spawned ? { "probe-consumer": { spawned, completed, errored } } : {},
          total_spawned: spawned,
          total_completed: completed,
          total_errored: errored,
        },
      });
    const model = "claude-3-7-sonnet-20250219";
    assert.equal(
      sig(
        put("ok", stats(1, 1, 0, "wrote crewrig-probe-b-N")),
        "Probe-consumer",
        "crewrig-probe-b-N",
      ),
      `true|true|true|${model}`,
    );
    assert.equal(
      sig(put("none", stats(0, 0, 0, "No such agent")), "Probe-consumer", "crewrig-probe-b-N"),
      `false|false|false|${model}`,
    );
    assert.equal(
      sig(put("err", stats(1, 0, 1, "failed")), "Probe-consumer", "crewrig-probe-b-N"),
      `true|false|false|${model}`,
    );
  });
});

describe("local.toml.example and defaults.toml (R7)", () => {
  const read = (f: string) => fs.readFileSync(path.join(REPO, "tests", "e2e", f), "utf8");
  test("the example declares both byok keys; defaults.toml [cli.copilot] declares neither", () => {
    const ex = read("local.toml.example");
    assert.ok(ex.includes("byok_provider") && ex.includes("byok_model"));
    const section = /^\[cli\.copilot\]\n([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(read("defaults.toml"));
    assert.ok(section, "[cli.copilot] section present");
    assert.ok(!/byok_(provider|model)/.test(section[1] ?? ""));
  });
});

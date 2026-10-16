// e2e-oracle-libs-cases-markers.ts — library cases for mask_command.sh and probe_spawn_markers.sh
// (spec 0261 R9): every mask case of test-e2e-probes.sh (L457-530) and every spawn-marker case
// (L541-690), plus extra shapes of the two libraries. Transcripts are seeded from the committed
// fixtures under scripts/tests/fixtures/probe-a-transcripts/ read as bytes (latin1 seeds).

import fs from "node:fs";
import path from "node:path";

import { bytes } from "./e2e-oracle-libs-cases-assert.ts";
import type { LibCase, LibSeedFile } from "./e2e-oracle-libs-types.ts";

const MASK = "tests/e2e/lib/mask_command.sh";
const SPAWN = "tests/e2e/lib/probe_spawn_markers.sh";
const FIXTURES = path.resolve(import.meta.dirname, "..", "fixtures", "probe-a-transcripts");

const fixture = (name: string): LibSeedFile => ({
  path: "t.txt",
  content: fs.readFileSync(path.join(FIXTURES, name)).toString("latin1"),
});
const text = (content: string): LibSeedFile => ({ path: "t.txt", content: bytes(content) });

const mask = (id: string, raw: string): LibCase => ({
  id: `mask/${id}`,
  lib: MASK,
  fn: "e2e_mask_command_string",
  args: [raw],
});
const maskJson = (id: string, stdin: string): LibCase => ({
  id: `mask/${id}`,
  lib: MASK,
  fn: "e2e_mask_command_json",
  stdin,
  tools: ["jq"],
});
const spawn = (id: string, seed: LibSeedFile | null, agent: string, nonce: string): LibCase => ({
  id: `spawn/${id}`,
  lib: SPAWN,
  fn: "e2e_probe_spawn_signals",
  args: [seed ? seed.path : "missing.txt", agent, nonce],
  ...(seed ? { seed: [seed] } : {}),
  tools: ["jq"],
});

const synthetic = `✗ Probe-router(sonnet) Nonce emission probe leg
  └ Agent completed but produced no response.

The agent returned no output. I found its declared nonce in the AGENT.md
file and I'll write it directly: crewrig-probe-SYNTHETIC-ELSEWHERE

● Write leg.txt (shell)
  │ printf 'crewrig-probe-SYNTHETIC-ELSEWHERE' > /out/leg.txt
  └ 1 line written
`;

const claudeJson = (spawned: number, completed: number, errored: number, byType: string): string =>
  `{"type":"result","result":"crewrig-probe-b-NONCE",` +
  `"modelUsage":{"claude-3-7-sonnet-20250219":{"inputTokens":10}},` +
  `"subagent_stats":{"total_spawned":${spawned},"total_completed":${completed},` +
  `"total_errored":${errored},"by_type":${byType}}}\n`;
const object = (s: number, c: number, e: number): string =>
  `{"probe-consumer":{"spawned":${s},"completed":${c},"errored":${e}}}`;

export const cases: LibCase[] = [
  // mask_command.sh — string form (bypass a, collateral, bypass b, quote boundary)
  mask("string-flag-style", "ollama launch copilot --api-key=sk-abc123 --yes"),
  mask("string-quoted-with-space", 'OLLAMA_API_KEY="sk secret withspace" ollama serve'),
  mask("string-single-quoted", "KEY='a b c' run"),
  mask("string-after-quote-boundary", 'bash -c "OLLAMA_MODELS=/tmp/x ollama launch copilot"'),
  mask("string-start-of-string", "TOKEN=abc run"),
  mask("string-after-separators", "a;K1=v1 b&K2=v2 c|K3=v3 (K4=v4)"),
  mask("string-no-assignment", "ollama launch copilot --model foo"),
  mask("string-empty-value", "KEY= run"),
  mask("string-double-dash-and-single-dash", "-x=1 --y-z=2 ---w=3"),
  mask("string-not-after-boundary", "foo-KEY=bar a/b=c"),
  mask("string-empty", ""),
  maskJson(
    "json-preserves-order-and-dash-c",
    '["bash","-c","OLLAMA_API_KEY=\\"sk secret\\" ollama serve --api-key=sk-xyz","sh"]',
  ),
  maskJson("json-empty-array", "[]"),
  maskJson("json-plain-elements", '["a","b c","--flag"]'),

  // probe_spawn_markers.sh — the three genuine transcripts of live run 20260902T132406Z-088f
  spawn(
    "genuine-success",
    fixture("control-no-hint.stdout"),
    "Probe-router",
    "crewrig-probe-de91a90702907b2b",
  ),
  spawn(
    "forged-hint-efficacy",
    fixture("hint-efficacy.stdout"),
    "Probe-router",
    "crewrig-probe-0bc218c9d711cabe",
  ),
  spawn(
    "forged-model-bearing",
    fixture("model-bearing.stdout"),
    "Probe-router",
    "crewrig-probe-7ca75a2dc6b32083",
  ),
  spawn(
    "agent-name-case-insensitive",
    fixture("control-no-hint.stdout"),
    "PROBE-ROUTER",
    "crewrig-probe-de91a90702907b2b",
  ),
  spawn(
    "other-agent-not-observed",
    fixture("control-no-hint.stdout"),
    "Other-agent",
    "crewrig-probe-de91a90702907b2b",
  ),
  spawn(
    "nonce-not-in-result",
    fixture("control-no-hint.stdout"),
    "Probe-router",
    "crewrig-probe-unrelated",
  ),
  // synthetic and edge shapes
  spawn(
    "nonce-elsewhere-not-credited",
    text(synthetic),
    "Probe-router",
    "crewrig-probe-SYNTHETIC-ELSEWHERE",
  ),
  spawn("missing-file", null, "Probe-router", "anything"),
  spawn(
    "glued-marker",
    text("done.✗ Probe-router(m1) t\n  └ Agent completed but produced no response.\n"),
    "Probe-router",
    "n",
  ),
  spawn(
    "idle-and-background-ack",
    text(
      "● Probe-router(m2) t\n  └ idle\n● Probe-router(m3) t\n  └ Agent started in background with agent_id: x\n",
    ),
    "Probe-router",
    "n",
  ),
  spawn(
    "reply-with-nonce-last-model-wins",
    text(
      "✗ Probe-router(m1) t\n  └ Agent completed but produced no response.\n● Probe-router(m2) t\n  └ here is NONCE-1\n",
    ),
    "Probe-router",
    "NONCE-1",
  ),
  spawn(
    "marker-without-result-line",
    text("● Probe-router(m1) t\nplain line\n  └ orphan result NONCE-2\n"),
    "Probe-router",
    "NONCE-2",
  ),
  spawn("empty-file", text(""), "Probe-router", "n"),
  // Claude Code structured JSON (subagent_stats fast path)
  spawn(
    "json-success",
    text(claudeJson(1, 1, 0, object(1, 1, 0))),
    "Probe-consumer",
    "crewrig-probe-b-NONCE",
  ),
  spawn(
    "json-unspawned",
    text(claudeJson(0, 0, 0, "{}")),
    "Probe-consumer",
    "crewrig-probe-b-NONCE",
  ),
  spawn(
    "json-errored",
    text(claudeJson(1, 0, 1, object(1, 0, 1))),
    "Probe-consumer",
    "crewrig-probe-b-NONCE",
  ),
  spawn(
    "json-numeric-by-type-value",
    text(claudeJson(1, 1, 0, '{"probe-consumer":1}')),
    "Probe-consumer",
    "crewrig-probe-b-NONCE",
  ),
  spawn(
    "json-numeric-by-type-failed",
    text('{"subagent_stats":{"completed":1,"failed":1,"by_type":{"probe-consumer":1}}}'),
    "Probe-consumer",
    "n",
  ),
  spawn(
    "json-nonce-absent-from-file",
    text(claudeJson(1, 1, 0, object(1, 1, 0))),
    "Probe-consumer",
    "never-present",
  ),
  spawn("json-no-model-usage", text('{"subagent_stats":{"by_type":{}}}'), "Probe-consumer", "n"),
  spawn("json-other-agent-type", text(claudeJson(1, 1, 0, object(1, 1, 0))), "Someone-else", "n"),
];

// mempalace-transcript-antigravity-payload.test.ts — the Antigravity payload handling of the
// transcript hook (spec 0116 R7-R11), groups G20-G26 of the Bash suite
// test-setup-antigravity-transcript.sh (spec 0263), black-box against the loopback stub daemon.
// Every run uses a scratch HOME and USERPROFILE, the stub port and a scratch token: the real daemon
// and the real token are never reached. All platforms (the entry is spawned directly).

import assert from "node:assert/strict";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import {
  closedPort,
  daemonEnv,
  drawerArgs,
  makeHome,
  runHook,
  startStub,
  writeToken,
  type Stub,
} from "./lib/transcript-runtime.ts";
import { cleanupAll, type Result } from "./lib/worktree-fixtures.ts";

const CONV = "d8b1fa4a-16a1-4cc0-8bda-ea52da904ba3";
const agy = (extra: object): string =>
  JSON.stringify({ conversationId: CONV, modelName: "claude-sonnet-4-6", ...extra });
const STOP = agy({
  error: "",
  executionNum: 0,
  fullyIdle: true,
  terminationReason: "NO_TOOL_CALL",
  workspacePaths: ["/work/myproject"],
});
const PRE = agy({ initialNumSteps: 1, invocationNum: 0, workspacePaths: [] });

let stub: Stub;
let home: string;
let token: string;
before(async () => {
  stub = await startStub("ok");
  home = makeHome();
  token = writeToken(path.join(home, "t"));
});
after(async () => {
  await stub.stop();
  cleanupAll();
});

const run = (args: string[], input: string | null, enabled = "1"): Result =>
  runHook(args, input, {
    env: daemonEnv(home, stub.port, token, { MEMPALACE_TRANSCRIPT_ENABLED: enabled }),
  });

describe("acknowledgement (R10; G20, G22-G24)", () => {
  test("a Stop answers exactly one {} line, with no decision key", () => {
    const res = run(["antigravity-cli", "Stop"], STOP);
    assert.equal(res.stdout, "{}\n");
    assert.equal("decision" in (JSON.parse(res.stdout) as object), false);
  });

  test("the opted-out path still answers {}", () => {
    assert.equal(run(["antigravity-cli", "Stop"], STOP, "0").stdout, "{}\n");
  });

  for (const broken of ["NOT JSON", ""]) {
    test(`an unparseable payload (${JSON.stringify(broken)}) is acknowledged, with an unreachable daemon`, async () => {
      const dead = await closedPort();
      const res = runHook(["antigravity-cli", "Stop"], broken, {
        env: daemonEnv(home, dead, token, { MEMPALACE_TRANSCRIPT_ENABLED: "1" }),
      });
      assert.equal(res.stdout, "{}\n");
    });
  }
});

describe("classification, room and content (R7-R9; G21, G25)", () => {
  test("Stop records an agent-response in a project-conversation room, with the reason suffix", () => {
    const seen = stub.requests().length;
    const res = run(["antigravity-cli", "Stop"], STOP);
    assert.match(res.stderr, /persisted agent-response to transcripts\/myproject-\S*-d8b1fa4a/);
    const sent = stub.requests().slice(seen);
    assert.equal(sent.length, 1);
    const last = sent[0];
    assert.ok(last);
    assert.equal(drawerArgs(last)["content"], "[AGENT] Session turn completed (NO_TOOL_CALL)");
  });

  test("PreInvocation with an empty workspace list still persists a session-lifecycle entry", () => {
    const res = run(["antigravity-cli", "PreInvocation"], PRE);
    assert.equal(res.stdout, "{}\n");
    assert.match(res.stderr, /persisted session-lifecycle to transcripts\//);
  });
});

describe("no regression for the other CLIs (R11; G26)", () => {
  const cases: [string, string, RegExp | null][] = [
    [
      "Claude Stop",
      '{"hook_event_name":"Stop","stop_hook_active":false}',
      /persisted agent-response/,
    ],
    [
      "Claude UserPromptSubmit",
      '{"hook_event_name":"UserPromptSubmit","prompt":"hello"}',
      /persisted user-prompt/,
    ],
    ["Gemini user_input", '{"user_input":"gemini prompt"}', /persisted user-prompt/],
    ["Gemini model_response", '{"model_response":"gemini answer"}', /persisted agent-response/],
    [
      "Copilot stdin",
      '{"session_id":"abc12345","workspace_dir":"/work/wsproj","prompt":"p"}',
      /persisted user-prompt to transcripts\/wsproj-\S*-abc12345/,
    ],
    ["issue 91 PostToolUse", '{"hook_event_name":"PostToolUse","tool_name":"Bash"}', null],
  ];
  for (const [name, payload, expected] of cases) {
    test(`${name}: silent stdout, ${expected ? "recorded" : "nothing persisted"}`, () => {
      const res = run([], payload);
      assert.equal(res.stdout, "");
      if (expected) assert.match(res.stderr, expected);
      else assert.equal(res.stderr.includes("persisted"), false);
    });
  }
});

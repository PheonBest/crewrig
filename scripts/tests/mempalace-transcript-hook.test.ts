// mempalace-transcript-hook.test.ts — port of test-mempalace-transcript-hook.sh
// (spec 0260, row J1a, unit A3). Black box through the entry
// `node hooks/mempalace-transcript.ts` against the loopback stub daemon: what the
// hook sends, what it prints, how it exits. Every scenario is a function of the
// shim path so the same check proves the real hook (must pass) and a mutated
// temp copy of it (must fail): a mutant that survives is a test that proves nothing.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { after, describe, test } from "node:test";

import { requireOrSkip } from "./lib/capability.ts";
import { applyMutation, copyTracked, type MutationCopy } from "./lib/mutation-copy.ts";
import {
  closedPort,
  daemonEnv,
  drawerArgs,
  hookEnv,
  HOOK_TS,
  makeHome,
  startStub,
  writeToken,
  type StubRequest,
} from "./lib/transcript-runtime.ts";
import { cleanupAll, REPO, which } from "./lib/worktree-fixtures.ts";

type Scenario = (shim: string) => Promise<string | null>;

const STOP = '{"hook_event_name":"Stop"}';
const POST_TOOL =
  '{"hook_event_name":"PostToolUse","tool_name":"Bash","tool_input":{"command":"ls"}}';
const ENABLED = { MEMPALACE_TRANSCRIPT_ENABLED: "1" };

/** Pipe `input` through `bash <shim>` (legacy no-argument form, enabled by the environment). */
function runShim(shim: string, input: string, env: NodeJS.ProcessEnv, cwd: string) {
  const r = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", shim], {
    input,
    env,
    cwd,
    encoding: "utf8",
    timeout: 60_000,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** One scenario against a fresh stub and home; `body` returns a violation or null. */
async function withRig(
  body: (rig: {
    home: string;
    token: string;
    port: number;
    requests: () => StubRequest[];
  }) => string | null | Promise<string | null>,
): Promise<string | null> {
  const stub = await startStub("ok");
  try {
    const home = makeHome();
    const token = writeToken(path.join(home, "t"), "token\n");
    return await body({ home, token, port: stub.port, requests: stub.requests });
  } finally {
    await stub.stop();
  }
}

const contents = (reqs: StubRequest[]): string[] =>
  reqs.map((r) => String(drawerArgs(r)["content"]));

// issue-91
const postToolUseSkipped: Scenario = (shim) =>
  withRig(({ home, token, port, requests }) => {
    runShim(shim, POST_TOOL, daemonEnv(home, port, token, ENABLED), home);
    return requests().length === 0 ? null : `the daemon received ${requests().length} request(s)`;
  });

// issue-510-r1
const quietSuppresses: Scenario = (shim) =>
  withRig(({ home, token, port }) => {
    const env = daemonEnv(home, port, token, { ...ENABLED, MEMPALACE_TRANSCRIPT_QUIET: "1" });
    const res = runShim(shim, STOP, env, home);
    return res.stderr.includes("mempalace-transcript: persisted")
      ? "persisted line under QUIET=1"
      : null;
  });

// issue-510-r2
const defaultLogs: Scenario = (shim) =>
  withRig(({ home, token, port }) => {
    const res = runShim(shim, STOP, daemonEnv(home, port, token, ENABLED), home);
    return res.stderr.includes("mempalace-transcript: persisted") ? null : "no persisted line";
  });

// issue-510-r3
const failureNotSilenced: Scenario = async (shim) => {
  const home = makeHome();
  const token = writeToken(path.join(home, "t"), "token\n");
  const port = await closedPort();
  const env = daemonEnv(home, port, token, { ...ENABLED, MEMPALACE_TRANSCRIPT_QUIET: "1" });
  const res = runShim(shim, STOP, env, home);
  return res.stderr.includes("mempalace-transcript: FAILED to persist") ? null : "no FAILED line";
};

/** A prompt run under a derived token (`<home>/.mempalace/server/<24 hex>/token`), as the Bash case. */
function promptScenario(prompts: readonly string[], expected: readonly string[]): Scenario {
  return (shim) =>
    withRig(({ home, port, requests }) => {
      writeToken(path.join(home, ".mempalace", "server", "1".repeat(24)), "token\n");
      const env = hookEnv(home, {
        ...ENABLED,
        MEMPALACE_MCP_HOST: "127.0.0.1",
        MEMPALACE_MCP_PORT: String(port),
      });
      for (const prompt of prompts) {
        runShim(shim, JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt }), env, home);
      }
      const got = contents(requests());
      const missing = expected.filter((want) => !got.some((c) => c.startsWith(want)));
      return missing.length === 0
        ? null
        : `missing ${JSON.stringify(missing)} in ${JSON.stringify(got)}`;
    });
}

// spec-0161-r1/r2
const humanPrompt = promptScenario(["Run the test suite"], ["[USER] Run the test suite"]);
// spec-0161-r1/r3 (task-notification, system-reminder)
const harnessTask = promptScenario(
  [
    "<task-notification>\n<task-id>bqhfosl1o</task-id>\n<summary>CI pass</summary>\n</task-notification>",
  ],
  ["[HARNESS] <task-notification>"],
);
const harnessReminder = promptScenario(
  ["<system-reminder>Remember to verify CI</system-reminder>"],
  ["[HARNESS] <system-reminder>"],
);

const SECRET = "custom-secret-token";
/** Run a Stop with MEMPALACE_DAEMON_TOKEN_FILE naming a file that holds SECRET. */
async function runWithSecret(shim: string): Promise<StubRequest[]> {
  const stub = await startStub("ok");
  try {
    const home = makeHome();
    const file = writeToken(path.join(home, "explicit"), `${SECRET}\n`);
    runShim(shim, STOP, daemonEnv(home, stub.port, file, ENABLED), home);
    return stub.requests();
  } finally {
    await stub.stop();
  }
}

// spec-0167-r1
const tokenFileBearer: Scenario = async (shim) => {
  const reqs = await runWithSecret(shim);
  return reqs.some((r) => r.authorization === `Bearer ${SECRET}`)
    ? null
    : JSON.stringify(reqs.map((r) => r.authorization));
};

// issue-1247 (request side; argv spying stays in mempalace-transcript-daemon.test.ts)
const tokenOnlyInAuthorization: Scenario = async (shim) => {
  const reqs = await runWithSecret(shim);
  if (!reqs.some((r) => r.authorization === `Bearer ${SECRET}`))
    return "daemon never received the token (vacuous)";
  const leaked = reqs.filter((r) =>
    JSON.stringify([r.url, r.contentType, r.body]).includes(SECRET),
  );
  return leaked.length === 0 ? null : `token outside Authorization: ${leaked.map((r) => r.url)}`;
};

// spec-0167-r3
const missingToken: Scenario = async (shim) => {
  const home = makeHome();
  const env = hookEnv(home, ENABLED);
  const res = runShim(shim, STOP, env, home);
  if (res.status !== 0) return `exit ${res.status}`;
  return res.stderr.includes("DAEMON_UNREACHABLE: token file not found")
    ? null
    : "no DAEMON_UNREACHABLE text";
};

const SCENARIOS: Array<[string, Scenario]> = [
  ["issue-91: PostToolUse skipped", postToolUseSkipped],
  ["issue-510-r1: QUIET=1 suppresses the success log", quietSuppresses],
  ["issue-510-r2: success log present when QUIET is unset", defaultLogs],
  ["issue-510-r3: failure log still emitted under QUIET=1", failureNotSilenced],
  ["spec-0161-r1/r2: human prompt is [USER] Run the test suite", humanPrompt],
  ["spec-0161-r1/r3: task-notification is [HARNESS]", harnessTask],
  ["spec-0161-r1/r3: system-reminder is [HARNESS]", harnessReminder],
  ["spec-0167-r1: MEMPALACE_DAEMON_TOKEN_FILE yields Bearer custom-secret-token", tokenFileBearer],
  ["issue-1247: token absent from every URL and non-Authorization field", tokenOnlyInAuthorization],
  ["spec-0167-r3: missing token, DAEMON_UNREACHABLE: token file not found, exit 0", missingToken],
];

const HAVE_BASH = which("bash") !== null;

after(() => cleanupAll());

describe("hook through its entry (node hooks/mempalace-transcript.ts)", () => {
  for (const [name, scenario] of SCENARIOS) {
    test(name, async (t) => {
      assert.equal(await scenario(HOOK_TS), null);
    });
  }
});

// Mutation proof: each mutant is a temp copy of the hook; the named scenario must fail on it.
const MUTANTS: Array<[string, string, string | RegExp, string, string]> = [
  [
    "drop the [HARNESS] prefix",
    "scripts/lib/mempalace-transcript/classify.ts",
    "content: `[HARNESS] ${text}`",
    "content: text",
    "spec-0161-r1/r3: task-notification is [HARNESS]",
  ],
  [
    "emit [USER] for harness text",
    "scripts/lib/mempalace-transcript/classify.ts",
    "content: `[HARNESS] ${text}`",
    "content: `[USER] ${text}`",
    "spec-0161-r1/r3: system-reminder is [HARNESS]",
  ],
  [
    "log success even when quiet",
    "scripts/lib/mempalace-transcript/run.ts",
    '["MEMPALACE_TRANSCRIPT_QUIET"] !== "1"',
    '["MEMPALACE_TRANSCRIPT_QUIET"] !== "never"',
    "issue-510-r1: QUIET=1 suppresses the success log",
  ],
  [
    "swallow the failure log",
    "scripts/lib/mempalace-transcript/run.ts",
    "log(`mempalace-transcript: FAILED to persist",
    "void (`mempalace-transcript: FAILED to persist",
    "issue-510-r3: failure log still emitted under QUIET=1",
  ],
  [
    "send a request on PostToolUse",
    "hooks/mempalace-transcript.ts",
    'if (event === "PostToolUse") return;',
    'if (event === "PostToolUse") { event = "UserPromptSubmit"; }',
    "issue-91: PostToolUse skipped",
  ],
  [
    "ignore MEMPALACE_DAEMON_TOKEN_FILE",
    "scripts/lib/mempalace-transcript/token.ts",
    'env["MEMPALACE_DAEMON_TOKEN_FILE"]',
    "undefined",
    "spec-0167-r1: MEMPALACE_DAEMON_TOKEN_FILE yields Bearer custom-secret-token",
  ],
  [
    "put the token in a URL",
    "scripts/lib/mempalace-transcript/daemon.ts",
    'path: "/mcp",',
    "path: `/mcp?t=${request.token}`,",
    "issue-1247: token absent from every URL and non-Authorization field",
  ],
  [
    "exit 1 without a token",
    "scripts/lib/mempalace-transcript/run.ts",
    "log(outcome.diagnostic);",
    "log(outcome.diagnostic); process.exitCode = 1;",
    "spec-0167-r3: missing token, DAEMON_UNREACHABLE: token file not found, exit 0",
  ],
];

describe("mutation proof: every mutant of a temp copy is caught", () => {
  for (const [name, file, needle, replacement, caughtBy] of MUTANTS) {
    test(`MUTATION RED ${name} -> ${caughtBy}`, async (t) => {
      let copy: MutationCopy | undefined;
      try {
        copy = copyTracked(REPO, ["hooks", "scripts/lib", "package.json"], {
          linkNodeModules: true,
        });
        applyMutation(copy, file, needle, replacement);
        const scenario = SCENARIOS.find(([n]) => n === caughtBy)![1];
        const violation = await scenario(path.join(copy.root, "hooks", "mempalace-transcript.ts"));
        assert.notEqual(violation, null, `mutant survived: ${name}`);
      } finally {
        copy?.dispose();
      }
    });
  }
});

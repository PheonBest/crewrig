// setup-transcript-antigravity-manifest.test.ts — the shipped manifest
// hooks/antigravity-transcript-hooks.json against the CLI's real contract (spec 0116 R1-R5, R27),
// ported from groups G1-G8 of the Bash suite test-setup-antigravity-transcript.sh (spec 0263).
// Pure reads, no deployment; all platforms.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { at, GUARD, MANIFEST, OURS, readJson } from "./lib/antigravity-transcript-rig.ts";
import { REPO, runNode } from "./lib/worktree-fixtures.ts";

const text = fs.readFileSync(MANIFEST, "utf8");
const doc = readJson(MANIFEST);
const REAL_EVENTS = ["PreToolUse", "PostToolUse", "PreInvocation", "PostInvocation", "Stop"];
const events = (hook: string): string[] =>
  Object.keys(at(doc, hook) as object).filter((key) => key !== "enabled");

describe("named-hook map (R1, G1, G2)", () => {
  test("the manifest is valid JSON", () => {
    assert.doesNotThrow(() => JSON.parse(text));
  });

  test("no top-level hooks key (the Gemini shape); every top-level value is a named hook object", () => {
    assert.equal("hooks" in doc, false);
    const values = Object.values(doc);
    assert.ok(values.length >= 1);
    for (const value of values) {
      assert.equal(typeof value, "object");
      assert.notEqual(value, null);
    }
  });
});

describe("events (R2, R3, G3, G4)", () => {
  test("every registered event is one the CLI actually has", () => {
    for (const hook of Object.keys(doc)) {
      for (const event of events(hook)) assert.ok(REAL_EVENTS.includes(event), `${hook}: ${event}`);
    }
  });

  for (const retired of ["BeforeAgent", "AfterTool", "AfterModel", "SessionEnd"]) {
    test(`the retired spec-0056 event ${retired} is gone from the raw text`, () => {
      assert.equal(text.includes(retired), false);
    });
  }

  test("Stop is the only event registered under the transcript hook (agy 1.0.16 cardinality)", () => {
    assert.deepEqual(Object.keys(at(doc, OURS) as object), ["Stop"]);
  });

  for (const noisy of ["PreToolUse", "PostToolUse", "PreInvocation", "PostInvocation"]) {
    test(`the high-frequency event ${noisy} is not registered under the transcript hook`, () => {
      assert.equal(Object.keys(at(doc, OURS) as object).includes(noisy), false);
    });
  }
});

describe("commands (R4, R5, G6, G7)", () => {
  test("no command depends on $PWD", () => {
    assert.equal(text.includes("$PWD"), false);
  });

  test("every transcript command ends with the event name it is registered under", () => {
    for (const event of events(OURS)) {
      const handlers = at(doc, OURS, event);
      assert.ok(Array.isArray(handlers) && handlers.length > 0);
      for (const handler of handlers as unknown[]) {
        const command = at(handler, "command");
        assert.equal(typeof command === "string" && command.endsWith(event), true, `${event}`);
      }
    }
  });
});

describe("worktree git guard (R27, G8)", () => {
  test("the manifest carries the named hook", () => {
    assert.ok(GUARD in doc);
  });

  test("PreToolUse[0].matcher is run_command", () => {
    assert.equal(at(doc, GUARD, "PreToolUse", 0, "matcher"), "run_command");
  });

  test("the group carries a hooks array (grouped shape)", () => {
    assert.ok(Array.isArray(at(doc, GUARD, "PreToolUse", 0, "hooks")));
  });

  test("the handler command names hooks/worktree-git-guard.ts", () => {
    const command = at(doc, GUARD, "PreToolUse", 0, "hooks", 0, "command");
    assert.equal(
      typeof command === "string" && command.includes("hooks/worktree-git-guard.ts"),
      true,
    );
  });
});

describe("setup declaration facts (R12, R14; G18)", () => {
  const printed = runNode(
    path.join(REPO, "scripts", "tests", "lib", "print-setup-declarations.ts"),
    ["antigravity"],
    {
      nodeArgs: ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON"],
    },
  );
  const fact = (key: string): string | undefined =>
    printed.stdout
      .split("\n")
      .find((line) => line.startsWith(`${key}=`))
      ?.slice(key.length + 1);

  test("the printer is readable and non-empty (vacuity guard)", () => {
    assert.equal(printed.status, 0, printed.stderr);
    assert.notEqual(printed.stdout.trim(), "");
  });

  test("both prompts, the session-recording step, the agy-json channel and the target are declared", () => {
    assert.equal(
      fact("prompt.transcripts.header"),
      "Enable automatic session recording to MemPalace? (opt-in)",
    );
    assert.equal(fact("prompt.transcripts-confirm.header"), "Apply?");
    assert.match(printed.stdout, /^step \d+: session-recording$/m);
    assert.equal(fact("hooks.channel"), "agy-json");
    assert.equal(fact("hooks.file"), "<HOME>/.gemini/config/hooks.json");
  });

  test("the offer defaults to no (first option)", () => {
    assert.match(fact("prompt.transcripts.options") ?? "", /^no,/);
  });
});

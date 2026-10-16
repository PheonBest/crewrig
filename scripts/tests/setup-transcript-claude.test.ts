// setup-transcript-claude.test.ts — the shipped Claude Code session-recording manifest and its render step
// (spec 0169 R1-R3, spec 0211 R2, spec 0247 R20-R21, spec 0248 R28-R29). Ports
// scripts/tests/test-setup-claude-transcript.sh (G1-G5) onto the real render entry.

import assert from "node:assert/strict";
import { after, describe, test } from "node:test";

import {
  at,
  cleanScratch,
  commandsOf,
  isObject,
  nodeForm,
  POSIX_ONLY,
  readManifest,
  renderManifest,
  usesNoUsageCaptureSh,
} from "./lib/transcript-manifest-rig.ts";

after(cleanScratch);

describe("claude transcript manifest", { skip: POSIX_ONLY }, () => {
  const shipped = readManifest("claude");
  const rendered = renderManifest("claude");

  test("G1 shipped manifest: hooks is an object and PreToolUse names the guard with the project token", () => {
    assert.ok(isObject(shipped));
    assert.ok(isObject(at(shipped, "hooks")), "hooks is not an object");
    const guard = at(shipped, "hooks", "PreToolUse", 0, "hooks", 0, "command");
    assert.equal(typeof guard, "string");
    assert.ok(
      String(guard).includes("$CLAUDE_PROJECT_DIR/hooks/worktree-git-guard.ts"),
      String(guard),
    );
  });

  test("G2 render: valid JSON with the guard as the direct node form on the physical in-repo path", () => {
    assert.equal(rendered.status, 0, rendered.err);
    assert.ok(isObject(rendered.json) && isObject(at(rendered.json, "hooks")));
    assert.equal(
      at(rendered.json, "hooks", "PreToolUse", 0, "hooks", 0, "command"),
      nodeForm("worktree-git-guard.ts"),
    );
  });

  for (const ev of ["UserPromptSubmit", "PostToolUse", "Stop", "SessionEnd"]) {
    test(`G3 render: ${ev} runs the in-repo transcript hook with claude-code and no env prefix`, () => {
      const cmd = at(rendered.json, "hooks", ev, 0, "hooks", 0, "command");
      assert.equal(cmd, nodeForm("mempalace-transcript.ts", "claude-code"));
    });
  }

  test("G4 render: no $CLAUDE_PROJECT_DIR survives anywhere in the rendered file", () => {
    assert.notEqual(rendered.text, "");
    assert.ok(!rendered.text.includes("$CLAUDE_PROJECT_DIR"));
  });

  test("G5 render: no command names usage-capture.sh (spec 0211 R2)", () => {
    // Non-vacuity: an empty render would pass G4 and G5 trivially.
    assert.ok(commandsOf(rendered.json).length >= 5, "fewer than five rendered commands");
    assert.ok(usesNoUsageCaptureSh(rendered.json));
  });
});

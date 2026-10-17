// setup-transcript-gemini.test.ts — the shipped Gemini CLI session-recording manifest and its render step
// (spec 0169 R1-R3, spec 0211 R2, spec 0247 R20-R22, spec 0248 R28-R29). Ports
// scripts/tests/test-setup-gemini-transcript.sh (G1-G5) onto the real render entry.

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

const ENV = "MEMPALACE_TRANSCRIPT_ENABLED";

describe("gemini transcript manifest", { skip: POSIX_ONLY }, () => {
  const shipped = readManifest("gemini");
  const rendered = renderManifest("gemini");

  test("G1 shipped manifest: hooks is an object and BeforeTool names the worktree guard with the project token", () => {
    assert.ok(isObject(shipped));
    assert.ok(isObject(at(shipped, "hooks")), "hooks is not an object");
    const guard = at(shipped, "hooks", "BeforeTool", 0, "hooks", 0, "command");
    assert.equal(typeof guard, "string");
    assert.ok(
      String(guard).includes("${GEMINI_PROJECT_DIR}/hooks/worktree-git-guard.ts"),
      String(guard),
    );
  });

  test("G2 render: valid JSON, the BeforeTool guard is the direct node form without the transcript env", () => {
    assert.equal(rendered.status, 0, rendered.err);
    const guard = at(rendered.json, "hooks", "BeforeTool", 0, "hooks", 0, "command");
    assert.equal(guard, nodeForm("worktree-git-guard.ts"));
    assert.ok(!String(guard).includes(ENV));
  });

  for (const ev of ["BeforeAgent", "AfterTool", "AfterModel", "SessionEnd"]) {
    test(`G3 render: ${ev} runs the in-repo transcript hook with gemini-cli, no env prefix`, () => {
      const cmd = at(rendered.json, "hooks", ev, 0, "hooks", 0, "command");
      assert.equal(cmd, nodeForm("mempalace-transcript.ts", "gemini-cli"));
      assert.ok(!String(cmd).includes(ENV));
    });
  }

  test("G4 render: no ${GEMINI_PROJECT_DIR} survives anywhere in the rendered file", () => {
    assert.notEqual(rendered.text, "");
    assert.ok(!rendered.text.includes("${GEMINI_PROJECT_DIR}"));
  });

  test("G5 render: no command names usage-capture.sh (spec 0211 R2)", () => {
    assert.ok(commandsOf(rendered.json).length >= 5, "fewer than five rendered commands");
    assert.ok(usesNoUsageCaptureSh(rendered.json));
  });
});

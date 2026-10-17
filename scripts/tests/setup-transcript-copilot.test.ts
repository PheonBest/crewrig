// setup-transcript-copilot.test.ts — the shipped GitHub Copilot CLI session-recording manifest, the
// workspace settings and the user-level result (issue #825, spec 0211 R2, spec 0247, spec 0248 R28-R29).
// Ports scripts/tests/test-setup-copilot-transcript.sh (G1-G5). The Bash jq replay of the user-level
// patch was a copy of the setup's program, so it proved nothing about setup: the five-event leg now runs
// the real `merge-session-recording-hooks` entry over a scratch configuration.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import {
  at,
  cleanScratch,
  commandObjects,
  commandsOf,
  isObject,
  nodeForm,
  POSIX_ONLY,
  readJson,
  readManifest,
  REPO,
  renderManifest,
  runEntry,
  scratch,
  usesNoUsageCaptureSh,
  type Json,
} from "./lib/transcript-manifest-rig.ts";

after(cleanScratch);

const ENV = "MEMPALACE_TRANSCRIPT_ENABLED";
const EVENTS = ["sessionStart", "userPromptSubmitted", "postToolUse", "agentStop", "sessionEnd"];
const hooksOf = (json: Json): Record<string, Json> => {
  const hooks = at(json, "hooks");
  return isObject(hooks) ? hooks : {};
};

describe("copilot transcript manifest schema (R1)", () => {
  const shipped = readManifest("copilot");

  test("G1 hooks is an object", () => {
    assert.ok(isObject(at(shipped, "hooks")));
  });
  test("G1 version is the integer 1, not a string", () => {
    assert.equal(at(shipped, "version"), 1);
  });
  test("G1 every event key is camelCase", () => {
    const keys = Object.keys(hooksOf(shipped));
    assert.ok(keys.length > 0);
    assert.deepEqual(
      keys.filter((k) => !/^[a-z][a-zA-Z0-9]*$/.test(k)),
      [],
    );
  });
  test("G1 every entry has type 'command' and a command or bash field", () => {
    const entries = Object.values(hooksOf(shipped)).flatMap((v) => (Array.isArray(v) ? v : []));
    assert.ok(entries.length > 0);
    const bad = entries.filter(
      (e) => !isObject(e) || e["type"] !== "command" || !("command" in e || "bash" in e),
    );
    assert.deepEqual(bad, []);
  });
});

describe("copilot workspace settings (R2)", () => {
  for (const rel of ["config/copilot/settings.json.template", ".github/copilot/settings.json"]) {
    test(`G2 ${rel} has hooks={} and version=1`, () => {
      const doc = readJson(path.join(REPO, rel));
      assert.ok(isObject(at(doc, "hooks")), "hooks is not an object");
      assert.equal(at(doc, "version"), 1);
    });
  }
});

describe("copilot render and user-level result (R3)", { skip: POSIX_ONLY }, () => {
  const rendered = renderManifest("copilot");

  test("G3 render succeeds with a JSON object of hooks", () => {
    assert.equal(rendered.status, 0, rendered.err);
    assert.ok(isObject(at(rendered.json, "hooks")));
  });

  test("G4 preToolUse is the direct node form on the in-repo guard, without the transcript env", () => {
    const cmd = at(rendered.json, "hooks", "preToolUse", 0, "command");
    assert.equal(cmd, nodeForm("worktree-git-guard.ts"));
    assert.ok(!String(cmd).includes(ENV));
  });

  test("G4 the five lifecycle events run the in-repo transcript hook with copilot-cli", () => {
    for (const ev of EVENTS) {
      assert.equal(
        at(rendered.json, "hooks", ev, 0, "command"),
        nodeForm("mempalace-transcript.ts", "copilot-cli"),
        ev,
      );
    }
  });

  test("G4 merge (real entry): the five events and the guard land in the user config, env patch not applied", () => {
    const dir = scratch();
    const config = path.join(dir, "copilot", "hooks.json");
    // The real entry gets the Claude-style consent patch: Copilot CLI has no `env` key and no env prefix.
    const run = runEntry(dir, [
      "merge-session-recording-hooks",
      "copilot",
      config,
      rendered.file,
      `{"${ENV}":"1"}`,
    ]);
    assert.equal(run.status, 0, run.err);
    const merged = readJson(config);
    for (const ev of EVENTS) {
      const cmds = commandsOf(at(merged, "hooks", ev) ?? null);
      assert.deepEqual(cmds, [nodeForm("mempalace-transcript.ts", "copilot-cli")], ev);
    }
    assert.deepEqual(commandsOf(at(merged, "hooks", "preToolUse") ?? null), [
      nodeForm("worktree-git-guard.ts"),
    ]);
    assert.ok(!(isObject(merged) && "env" in merged), "env key written for copilot");
    assert.ok(
      !fs.readFileSync(config, "utf8").includes(ENV),
      "env name leaked into the copilot config",
    );
    assert.equal(fs.statSync(config).mode & 0o777, 0o600);
  });

  test("G5 no ${COPILOT_PROJECT_DIR token survives in the rendered output", () => {
    assert.notEqual(rendered.text, "");
    assert.ok(!rendered.text.includes("${COPILOT_PROJECT_DIR"));
  });
});

describe("copilot spec 0211 R2", () => {
  test("G5 the SOURCE manifest names no usage-capture.sh command", () => {
    const shipped = readManifest("copilot");
    assert.ok(commandObjects(shipped).length >= 6, "fewer than six source entries");
    assert.ok(usesNoUsageCaptureSh(shipped));
  });
});

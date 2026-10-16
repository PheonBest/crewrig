// setup-transcript-antigravity-deploy.test.ts — deploy_antigravity_transcript_hooks of
// scripts/lib/common.sh (spec 0116 R4, R5, R13-R15, R28; spec 0247 R21, R23(c)), ported from groups
// G9-G17 of the Bash suite test-setup-antigravity-transcript.sh (spec 0263). The helper is the Bash
// one: POSIX only. Retires with scripts/lib/common.sh (row J4). The TypeScript twin is pinned by
// setup-antigravity-hooks.test.ts and hook-transcript-antigravity.test.ts.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import {
  at,
  commands,
  deploy,
  GUARD,
  GUARD_SCRIPT,
  MANIFEST,
  OURS,
  readJson,
  type Json,
} from "./lib/antigravity-transcript-rig.ts";
import { cleanupAll, realTmp, REPO, type Result, SKIP_POSIX } from "./lib/worktree-fixtures.ts";

after(cleanupAll);

interface Site {
  readonly hooksDir: string;
  readonly target: string;
}
function site(seed?: unknown): Site {
  const home = realTmp("agy-deploy-");
  const target = path.join(home, ".gemini", "config", "hooks.json");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (seed !== undefined) {
    fs.writeFileSync(target, typeof seed === "string" ? seed : JSON.stringify(seed));
  }
  return { hooksDir: path.join(home, ".gemini", "antigravity-cli", "hooks"), target };
}
const guardCommand = (doc: Json): string =>
  String(at(doc, GUARD, "PreToolUse", 0, "hooks", 0, "command"));
const ENV_PREFIX = "MEMPALACE_TRANSCRIPT_ENABLED";

describe("accept path (R13, R14, R28, R5; G9-G11)", { skip: SKIP_POSIX }, () => {
  const s = site();
  let res: Result;
  before(() => {
    res = deploy(s.hooksDir, s.target);
  });
  const doc = (): Json => readJson(s.target);

  test("the helper exits zero on a clean target and installs no hook script copy", () => {
    assert.equal(res.status, 0, res.stderr);
    assert.equal(fs.existsSync(path.join(s.hooksDir, "mempalace-transcript.sh")), false);
  });

  test("every transcript command names the in-repo hook by absolute path, with no env prefix", () => {
    const head = `node "${path.join(fs.realpathSync.native(path.join(REPO, "hooks")), "mempalace-transcript.ts")}" antigravity-cli `;
    const ours = commands(at(doc(), OURS));
    assert.ok(ours.length > 0);
    for (const command of ours) {
      assert.ok(command.startsWith(head), command);
      assert.equal(command.includes(ENV_PREFIX), false);
    }
    assert.equal(fs.readFileSync(s.target, "utf8").includes("$PWD"), false);
  });

  test("the guard command contains the repository guard path and nothing of the transcript hook", () => {
    const command = guardCommand(doc());
    assert.ok(command.includes(GUARD_SCRIPT));
    assert.equal(command.includes("mempalace-transcript"), false);
    assert.equal(command.startsWith(`${ENV_PREFIX}=1`), false);
    for (const event of ["PreToolUse", "PostToolUse", "PreInvocation", "PostInvocation", "Stop"]) {
      assert.equal(command.endsWith(` ${event}`), false, event);
    }
  });

  test("every event of the shipped transcript hook survives as a command argument (dynamic read)", () => {
    const events = Object.keys(at(readJson(MANIFEST), OURS) as object).filter(
      (k) => k !== "enabled",
    );
    assert.ok(events.length > 0);
    for (const event of events) {
      assert.ok(
        commands(doc()).some((c) => c.endsWith(` ${event}`)),
        event,
      );
    }
  });
});

describe("existing manifests (R15, R2, R4; G12-G14)", { skip: SKIP_POSIX }, () => {
  test("an operator's hook survives verbatim, a backup is made, and a second run keeps the key set", () => {
    const lint = {
      PostToolUse: [{ matcher: "run_command", hooks: [{ type: "command", command: "./lint.sh" }] }],
    };
    const s = site({ "operator-lint-gate": lint });
    assert.equal(deploy(s.hooksDir, s.target).status, 0);
    const dir = path.dirname(s.target);
    const seed = JSON.stringify({ "operator-lint-gate": lint });
    // The first backup holds the operator's ORIGINAL bytes: a later merge step also backs the
    // target up, but only with an already-merged state, so only this one pins the helper's own.
    assert.ok(
      fs
        .readdirSync(dir)
        .filter((f) => f.startsWith("hooks.json.bak."))
        .some((f) => fs.readFileSync(path.join(dir, f), "utf8") === seed),
    );
    const first = readJson(s.target);
    assert.equal(
      at(first, "operator-lint-gate", "PostToolUse", 0, "hooks", 0, "command"),
      "./lint.sh",
    );
    assert.ok(Object.keys(first).some((k) => k !== "operator-lint-gate"));
    assert.equal(deploy(s.hooksDir, s.target).status, 0);
    assert.deepEqual(Object.keys(readJson(s.target)).sort(), Object.keys(first).sort());
  });

  test("our own named hook is replaced, not deep-merged: SessionEnd and $PWD do not survive", () => {
    const s = site({
      [OURS]: {
        SessionEnd: [{ type: "command", command: "bash $PWD/hooks/mempalace-transcript.sh" }],
      },
      "operator-keep": { Stop: [{ command: "./keep.sh" }] },
    });
    assert.equal(deploy(s.hooksDir, s.target).status, 0);
    const doc = readJson(s.target);
    assert.equal("SessionEnd" in (at(doc, OURS) as object), false);
    assert.equal(fs.readFileSync(s.target, "utf8").includes("$PWD"), false);
    assert.equal(at(doc, "operator-keep", "Stop", 0, "command"), "./keep.sh");
  });
});

describe("refusals (G15, G16)", { skip: SKIP_POSIX }, () => {
  test("a target that is not JSON fails, announces nothing, is left untouched and leaves no .tmp", () => {
    const s = site("this is not json at all");
    const res = deploy(s.hooksDir, s.target);
    assert.notEqual(res.status, 0);
    assert.equal(res.stdout.includes("Transcript hooks deployed"), false);
    assert.equal(fs.readFileSync(s.target, "utf8"), "this is not json at all");
    assert.equal(fs.existsSync(`${s.target}.tmp`), false);
  });

  test("an unreadable source manifest fails, writes no manifest and announces nothing", () => {
    const s = site();
    const res = deploy(
      s.hooksDir,
      s.target,
      path.join(path.dirname(s.target), "no-such-manifest.json"),
    );
    assert.notEqual(res.status, 0);
    assert.equal(fs.existsSync(s.target), false);
    assert.equal(res.stdout.includes("Transcript hooks deployed"), false);
  });
});

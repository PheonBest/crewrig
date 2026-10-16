// setup-transcript-antigravity-grouped.test.ts — the deployment rewrite over both element shapes
// (grouped PreToolUse, flat Stop) and a non-array member, against a synthetic manifest (group G17 of
// the Bash suite test-setup-antigravity-transcript.sh; spec 0263; spec 0247 R23(c)). POSIX only:
// it drives deploy_antigravity_transcript_hooks of scripts/lib/common.sh. Retires with
// scripts/lib/common.sh (row J4).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import {
  at,
  deploy,
  MANIFEST,
  OURS,
  readJson,
  type Json,
} from "./lib/antigravity-transcript-rig.ts";
import { cleanupAll, realTmp, SKIP_POSIX } from "./lib/worktree-fixtures.ts";

after(cleanupAll);

describe("grouped-and-disabled named hook", { skip: SKIP_POSIX }, () => {
  let doc: Json = {};
  before(() => {
    const home = realTmp("agy-grouped-");
    const src = path.join(home, "grouped-src.json");
    fs.writeFileSync(
      src,
      JSON.stringify({
        // the framework's own named hook rides along so the merge step (not only the guard step) runs
        [OURS]: at(readJson(MANIFEST), OURS),
        "grouped-and-disabled": {
          enabled: false,
          PreToolUse: [{ matcher: "run_command", hooks: [{ type: "command", command: "ORIG" }] }],
          Stop: [{ type: "command", command: "ORIG" }],
        },
      }),
    );
    const target = path.join(home, ".gemini", "config", "hooks.json");
    const res = deploy(path.join(home, "hooks"), target, src);
    assert.equal(res.status, 0, res.stderr);
    doc = readJson(target);
  });
  const hook = (...keys: (string | number)[]): unknown => at(doc, "grouped-and-disabled", ...keys);

  test("a non-array member (enabled: false) passes through untouched", () => {
    assert.equal(hook("enabled"), false);
  });

  test("a grouped event keeps its matcher and gets no bogus command key on the group", () => {
    assert.equal(hook("PreToolUse", 0, "matcher"), "run_command");
    assert.equal("command" in (hook("PreToolUse", 0) as object), false);
  });

  test("ORIG stays verbatim at both depths for a named hook that is not the framework's", () => {
    assert.equal(hook("PreToolUse", 0, "hooks", 0, "command"), "ORIG");
    assert.equal(hook("Stop", 0, "command"), "ORIG");
  });
});

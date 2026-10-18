// hook-recognition-without-shim-files.test.ts — spec 0266 R7, R9 (Class B gate).
//
// The legacy `.sh` command lines already installed on a machine must keep being
// recognised after the four Class B shims (hooks/{mempalace-transcript,
// usage-capture,worktree-git-guard,antigravity-statusline-shim}.sh) are deleted.
// A tree holding the tracked hooks/ directory WITHOUT any `*.sh` is built under
// mkdtemp; every legacy line of the recognition corpora is rooted at that tree
// and classified with the real filesystem stat, then compared with the same
// classification on a full copy. Recognition is string-based except for the one
// documented legacy spaced Gemini usage-capture form, which stats its path.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ANTIGRAVITY_STATUSLINE,
  USAGE_CAPTURE,
  WORKTREE_GIT_GUARD,
} from "../lib/hook-descriptor.ts";
import { orDirectSibling, parseHookCommand } from "../lib/hook-recognition.ts";
import { classifyTranscript } from "../lib/transcript-recognition.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const FIXTURES = path.join(HERE, "fixtures");
const CORPUS_ROOT = "/srv/co/crewrig";

const load = <T>(...parts: string[]): T =>
  JSON.parse(fs.readFileSync(path.join(FIXTURES, ...parts), "utf8")) as T;

const usage = load<{ command: string; capture: boolean }[]>(
  "usage-capture",
  "recognition-corpus.json",
);
const guard = load<{ command: string; guard: boolean; tsOnly?: boolean }[]>(
  "worktree-guard",
  "recognition-corpus.json",
);
const transcript = load<{ command: string; transcript: string }[]>(
  "mempalace-transcript",
  "recognition-corpus.json",
);
const statusline = load<{ command: string; recognised: boolean }[]>(
  "antigravity-statusline",
  "legacy-lines.json",
);

let base: string;
let full: string;
let stripped: string;
let spacedFull: string;
let spacedStripped: string;

const exists = (p: string): boolean => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

before(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-shimless-"));
  full = path.join(base, "full");
  stripped = path.join(base, "stripped");
  spacedFull = path.join(base, "my projects", "full");
  spacedStripped = path.join(base, "my projects", "stripped");
  for (const dest of [full, stripped, spacedFull, spacedStripped]) {
    fs.mkdirSync(dest, { recursive: true });
    fs.cpSync(path.join(REPO, "hooks"), path.join(dest, "hooks"), {
      recursive: true,
      filter: (src) => dest === full || dest === spacedFull || !src.endsWith(".sh"),
    });
  }
});
after(() => {
  if (base !== undefined && path.basename(base).startsWith("crewrig-shimless-")) {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

const rooted = (command: string, root: string): string => command.replaceAll(CORPUS_ROOT, root);

describe("the stripped tree really has no shell script", () => {
  test("hooks/ keeps its .ts and .json files and holds no .sh", () => {
    const names = fs.readdirSync(path.join(stripped, "hooks"));
    assert.ok(names.some((n) => n.endsWith(".ts")));
    assert.ok(names.some((n) => n.endsWith(".json")));
    assert.deepEqual(
      names.filter((n) => n.endsWith(".sh")),
      [],
    );
    assert.ok(fs.readdirSync(path.join(full, "hooks")).some((n) => n.endsWith(".sh")));
  });
});

describe("legacy lines classify the same without the shim files", () => {
  const cases: [string, (c: string, root: string) => unknown][] = [
    [
      "usage-capture",
      (c, r) => parseHookCommand(rooted(c, r), USAGE_CAPTURE, { pathExists: exists }) !== null,
    ],
    [
      "worktree-git-guard",
      (c, r) => parseHookCommand(rooted(c, r), WORKTREE_GIT_GUARD, { pathExists: exists }) !== null,
    ],
    ["mempalace-transcript", (c, r) => classifyTranscript(rooted(c, r))],
    [
      "antigravity-statusline",
      (c, r) =>
        parseHookCommand(rooted(c, r), ANTIGRAVITY_STATUSLINE, { pathExists: exists }) !== null,
    ],
  ];
  const rows: Record<string, string[]> = {
    "usage-capture": usage.map((r) => r.command),
    "worktree-git-guard": guard.map((r) => r.command),
    "mempalace-transcript": transcript.map((r) => r.command),
    "antigravity-statusline": statusline.map((r) => r.command),
  };
  for (const [name, classify] of cases) {
    test(`${name}: ${rows[name]!.length} corpus lines`, () => {
      assert.ok(rows[name]!.length >= 10);
      for (const command of rows[name]!) {
        assert.deepEqual(classify(command, stripped), classify(command, full), command);
      }
    });
  }

  test("corpus verdicts still hold on the stripped tree", () => {
    for (const r of usage) {
      const got =
        parseHookCommand(rooted(r.command, stripped), USAGE_CAPTURE, { pathExists: exists }) !==
        null;
      assert.equal(got, r.capture, r.command);
    }
    for (const r of guard) {
      const got =
        parseHookCommand(rooted(r.command, stripped), WORKTREE_GIT_GUARD, {
          pathExists: exists,
        }) !== null;
      // A tsOnly row is a guard on the TypeScript twin only (the corpus states it).
      assert.equal(got, r.guard || r.tsOnly === true, r.command);
    }
    for (const r of transcript) {
      assert.equal(classifyTranscript(rooted(r.command, stripped)), r.transcript, r.command);
    }
    for (const r of statusline) {
      const got =
        parseHookCommand(rooted(r.command, stripped), ANTIGRAVITY_STATUSLINE, {
          pathExists: exists,
        }) !== null;
      assert.equal(got, r.recognised, r.command);
    }
  });
});

describe("the one stat-based legacy form", () => {
  test("the spaced Gemini usage-capture line is recognised on a tree with no .sh, not when neither file exists", () => {
    const command = (root: string): string =>
      `bash ${root}/hooks/usage-capture.sh gemini-cli AfterModel`;
    const parse = (root: string, test: ((p: string) => boolean) | undefined) =>
      parseHookCommand(
        command(root),
        USAGE_CAPTURE,
        test === undefined ? {} : { pathExists: test },
      );
    // The default of the option stays "never recognised".
    assert.equal(parse(spacedFull, undefined), null);
    // The raw stat is what the deletion used to break.
    assert.notEqual(parse(spacedFull, exists), null);
    assert.equal(parse(spacedStripped, exists), null);
    // The shared helper accepts the sibling .ts: same verdict on both trees.
    assert.notEqual(parse(spacedFull, orDirectSibling(exists)), null);
    assert.notEqual(parse(spacedStripped, orDirectSibling(exists)), null);
    // Neither the .sh nor the .ts: not recognised.
    const bare = path.join(base, "my projects", "bare");
    fs.mkdirSync(path.join(bare, "hooks"), { recursive: true });
    assert.equal(parse(bare, orDirectSibling(exists)), null);
  });
});

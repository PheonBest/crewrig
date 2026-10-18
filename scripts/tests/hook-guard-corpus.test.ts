// hook-guard-corpus.test.ts — recognition by content, in both twins (spec 0248
// R31; scenarios 20, 21; named edit v1-F5).
//
// One corpus, fixtures/worktree-guard/recognition-corpus.json, is run through
// the TypeScript recognition (scripts/lib/hook-recognition.ts with the guard's
// descriptor) and through the Bash predicate that classifies framework-owned
// session-recording handlers (`sr_is_guard` and `sr_is_transcript` in
// scripts/lib/usage-capture-optin.sh). They accept and reject the same
// commands. The one exception is stated in the corpus: the Antigravity CLI
// guarded form is recognised by the TypeScript descriptor only (its flag
// `guardedPrefix`); no Bash path ever sees it. v1-F5: `bash
// /opt/tools/worktree-git-guard.sh` has no `/hooks/` directory and is a guard
// on neither twin. The last block states what the flag means for a guarded
// command that turns up in a Claude Code, Gemini CLI or Copilot CLI
// configuration, in the rewrite and in the session-recording merge (plan D3).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import { WORKTREE_GIT_GUARD } from "../lib/hook-descriptor.ts";
import { isHookCommand } from "../lib/hook-recognition.ts";
import { guardCommands, makeCheckout, wiring } from "./lib/guard-wiring-fixtures.ts";
import { cleanupAll, read, REPO, SKIP_POSIX } from "./lib/worktree-fixtures.ts";

interface Row {
  readonly command: string;
  readonly guard: boolean;
  readonly note: string;
  readonly transcript?: boolean;
  readonly tsOnly?: boolean;
}

after(cleanupAll);

const CORPUS_FILE = path.join(
  REPO,
  "scripts",
  "tests",
  "fixtures",
  "worktree-guard",
  "recognition-corpus.json",
);
const CORPUS = JSON.parse(read(CORPUS_FILE)) as Row[];

describe("the corpus", () => {
  test("is not empty and holds both verdicts, the v1-F5 row and the look-alikes of scenario 21", () => {
    assert.ok(CORPUS.length >= 25);
    assert.ok(CORPUS.some((row) => row.guard) && CORPUS.some((row) => !row.guard));
    const commands = CORPUS.map((row) => row.command);
    assert.ok(commands.includes("bash /opt/tools/worktree-git-guard.sh"));
    assert.ok(commands.includes('node "/opt/tools/worktree-git-guard.ts" --strict'));
    assert.ok(
      commands.some((c) => c.includes("&& bash /srv/co/crewrig/hooks/worktree-git-guard.sh")),
    );
  });
});

describe("the TypeScript recognition", () => {
  for (const row of CORPUS) {
    const verdict = row.tsOnly === true ? true : row.guard;
    test(`${verdict ? "guard" : "not guard"}: ${JSON.stringify(row.command)} (${row.note})`, () => {
      assert.equal(isHookCommand(row.command, WORKTREE_GIT_GUARD), verdict);
    });
  }
});

describe("a guarded command in a Claude Code, Gemini CLI or Copilot CLI configuration (D3; v1-F5)", () => {
  const GUARDED =
    "set NoDefaultCurrentDirectoryInExePath=1&& node C:/work/x/crewrig/hooks/worktree-git-guard.ts";
  const claude = (): string =>
    JSON.stringify({
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: GUARDED }] }] },
    });

  test("the rewrite leaves it as it is: it is already the direct form", () => {
    const co = makeCheckout();
    const file = path.join(path.dirname(co.repo), "claude.json");
    fs.writeFileSync(file, claude());
    const res = wiring("guard", "rewrite", "claude", "--config", file, "--repo", co.repo);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(read(file), claude(), "byte-identical");
    assert.match(res.stdout, /left .*already the direct form/);
  });
});

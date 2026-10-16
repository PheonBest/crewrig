// mutation-copy.test.ts — the shared mutation helper of spec 0260 (requirements 7
// and 8): tracked files only, a needle that is absent or a no-op edit fails.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { requireOrSkip } from "./lib/capability.ts";
import { applyMutation, copyTracked, trackedFiles } from "./lib/mutation-copy.ts";

function fixtureRepo(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mutation-copy-test-")));
  const git = (...args: string[]) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  git("init", "-q");
  fs.mkdirSync(path.join(dir, "lib"));
  fs.writeFileSync(path.join(dir, "lib", "a.js"), "const a = 1;\r\nconst b = 2;\r\n");
  fs.writeFileSync(path.join(dir, "untracked.js"), "not tracked\n");
  git("add", "lib/a.js");
  return dir;
}

test("copyTracked copies what git tracks and nothing else", () => {
  const repo = fixtureRepo();
  const copy = copyTracked(repo, ["lib"]);
  try {
    assert.deepEqual(trackedFiles(repo, ["lib"]), ["lib/a.js"]);
    assert.ok(fs.existsSync(path.join(copy.root, "lib", "a.js")));
    assert.ok(!fs.existsSync(path.join(copy.root, "untracked.js")));
  } finally {
    copy.dispose();
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("applyMutation edits the copy, never the original, and normalises CRLF", () => {
  const repo = fixtureRepo();
  const copy = copyTracked(repo, ["lib"]);
  try {
    applyMutation(copy, "lib/a.js", "const a = 1;\nconst b", "const a = 9;\nconst b");
    assert.match(fs.readFileSync(path.join(copy.root, "lib", "a.js"), "utf8"), /const a = 9;/);
    assert.match(fs.readFileSync(path.join(repo, "lib", "a.js"), "utf8"), /const a = 1;/);
  } finally {
    copy.dispose();
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("applyMutation fails, naming file and text, when the needle is absent", () => {
  const repo = fixtureRepo();
  const copy = copyTracked(repo, ["lib"]);
  try {
    assert.throws(
      () => applyMutation(copy, "lib/a.js", "const zzz", "x"),
      /mutation needle absent in lib\/a\.js: const zzz/,
    );
    assert.throws(
      () => applyMutation(copy, "lib/a.js", "const a", "const a"),
      /mutation changed nothing in lib\/a\.js/,
    );
  } finally {
    copy.dispose();
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("requireOrSkip: a present capability continues; an absent one fails under CI and skips otherwise", (t) => {
  assert.equal(requireOrSkip(t, true, "present"), true);
  const calls: string[] = [];
  const fake = { skip: (m: string) => calls.push(m) } as unknown as Parameters<
    typeof requireOrSkip
  >[0];
  const saved = process.env.CI;
  try {
    delete process.env.CI;
    assert.equal(requireOrSkip(fake, false, "no sqlite"), false);
    assert.deepEqual(calls, ["SKIP: no sqlite"]);
    process.env.CI = "true";
    assert.throws(
      () => requireOrSkip(fake, false, "no sqlite"),
      /required capability missing in CI: no sqlite/,
    );
  } finally {
    if (saved === undefined) delete process.env.CI;
    else process.env.CI = saved;
  }
});

test("requireOrSkip: a POSIX-only leg skips on win32 even when CI is set", () => {
  const calls: string[] = [];
  const fake = { skip: (m: string) => calls.push(m) } as unknown as Parameters<
    typeof requireOrSkip
  >[0];
  const saved = process.env.CI;
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  try {
    process.env.CI = "true";
    Object.defineProperty(process, "platform", { value: "win32" });
    assert.equal(requireOrSkip(fake, false, "needs bash", { posixOnly: true }), false);
    assert.match(calls[0] ?? "", /POSIX-only leg \(needs bash\)/);
  } finally {
    if (platform !== undefined) Object.defineProperty(process, "platform", platform);
    if (saved === undefined) delete process.env.CI;
    else process.env.CI = saved;
  }
});

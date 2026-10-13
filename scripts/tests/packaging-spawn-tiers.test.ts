// packaging-spawn-tiers.test.ts — the synchronous spawn helpers and the tier lookup of the
// release packager (spec 0257 R9). The packager itself is in packaging-release-package.test.ts.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { ExtError } from "../lib/extension/types.ts";
import { onPath, runDiscard, runInherit } from "../lib/packaging/spawn-sync.ts";
import { listTier, packageNotFound, resolveExtensionDir } from "../lib/packaging/tiers.ts";

const roots: string[] = [];
after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

function repo(layout: Record<string, string[]>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "packaging-tiers-"));
  roots.push(root);
  for (const [tier, names] of Object.entries(layout)) {
    fs.mkdirSync(path.join(root, "extensions", tier), { recursive: true });
    for (const name of names) {
      const target = path.join(root, "extensions", tier, name);
      if (name === "file") fs.writeFileSync(target, "x");
      else fs.mkdirSync(target);
    }
  }
  return root;
}

const here = { cwd: process.cwd(), env: process.env };

test("runInherit and runDiscard return the exit status", () => {
  assert.equal(runInherit([process.execPath, "-e", "process.exit(3)"], here), 3);
  assert.equal(runDiscard([process.execPath, "-e", "process.exit(0)"], here), 0);
});

test("a program that cannot be started is 127", () => {
  assert.equal(runInherit(["release-no-such-program-xyz"], here), 127);
  assert.equal(runDiscard(["release-no-such-program-xyz"], here), 127);
});

test("on Windows a name absent from PATH is 127 without any spawn", () => {
  const env = { PATH: "C:\\release-no-such-dir" };
  assert.equal(
    runDiscard(["gemini", "extensions", "validate", "C:\\b"], { cwd: "/", env, platform: "win32" }),
    127,
  );
});

test("onPath finds a program on PATH only", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "packaging-onpath-"));
  roots.push(dir);
  const name = process.platform === "win32" ? "tool.cmd" : "tool";
  fs.writeFileSync(path.join(dir, name), "");
  fs.chmodSync(path.join(dir, name), 0o755);
  assert.equal(onPath("tool", { PATH: dir }, process.platform), true);
  assert.equal(onPath("tool", { PATH: os.tmpdir() }, process.platform), false);
  assert.equal(onPath("tool", { PATH: "" }, process.platform), false);
});

test("resolveExtensionDir finds the one tier that holds the name", () => {
  const root = repo({ core: ["a"], library: ["b"], org: ["c"] });
  assert.equal(resolveExtensionDir(root, "a"), `${root}/extensions/core/a`);
  assert.equal(resolveExtensionDir(root, "b"), `${root}/extensions/library/b`);
  assert.equal(resolveExtensionDir(root, "c"), `${root}/extensions/org/c`);
});

test("resolveExtensionDir refuses a duplicate and an unknown name with each tool's text", () => {
  const root = repo({ core: ["a", "file"], library: ["a", "file"] });
  assert.throws(
    () => resolveExtensionDir(root, "a"),
    new ExtError("extension 'a' exists in multiple tiers; names must be unique."),
  );
  assert.throws(
    () => resolveExtensionDir(root, "zz"),
    new ExtError("extension 'zz' not found in extensions/."),
  );
  assert.throws(
    () => resolveExtensionDir(root, "zz", packageNotFound),
    new ExtError("extension 'zz' not found."),
  );
  // A plain file is not an extension directory.
  assert.throws(
    () => resolveExtensionDir(root, "file"),
    new ExtError("extension 'file' not found in extensions/."),
  );
});

test("listTier lists directories in UTF-8 byte order and skips hidden names and files", () => {
  const root = repo({ core: ["b", "a", "Z", "é", ".hidden", "file"] });
  assert.deepEqual(listTier(root, "core"), ["Z", "a", "b", "é"]);
  assert.deepEqual(listTier(root, "org"), []);
});

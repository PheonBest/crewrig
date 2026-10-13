// monorepo-release-clone-modules.test.ts — stageCloneModules and fallbackNotice (spec 0257 R17,
// Decision D4): js-yaml and argparse are real copies, every other entry a link or, when the link
// is refused, a reported copy.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { fallbackNotice, stageCloneModules } from "../lib/monorepo-release/clone-modules.ts";

const temps: string[] = [];
after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

/** A root whose node_modules holds the two real-copy packages, a plain one and hidden entries. */
function sandbox(): { root: string; clone: string } {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-cm-")));
  temps.push(base);
  const root = path.join(base, "root");
  const clone = path.join(base, "clone");
  const nm = path.join(root, "node_modules");
  fs.mkdirSync(path.join(nm, "js-yaml", "lib"), { recursive: true });
  fs.writeFileSync(path.join(nm, "js-yaml", "lib", "index.js"), "y");
  fs.mkdirSync(path.join(nm, "argparse"));
  fs.writeFileSync(path.join(nm, "argparse", "a.js"), "a");
  fs.mkdirSync(path.join(nm, "other"));
  fs.writeFileSync(path.join(nm, "other", "o.js"), "o");
  fs.mkdirSync(path.join(nm, ".bin"));
  fs.writeFileSync(path.join(nm, ".package-lock.json"), "{}");
  fs.mkdirSync(clone);
  return { root, clone };
}

const lstat = (p: string): fs.Stats => fs.lstatSync(p);
const POSIX = { skip: process.platform === "win32" };

describe("stageCloneModules", () => {
  test(
    "js-yaml and argparse are real copies with real files, even when the source is a link",
    POSIX,
    () => {
      const { root, clone } = sandbox();
      const nm = path.join(root, "node_modules");
      const target = path.join(path.dirname(root), "elsewhere");
      fs.mkdirSync(target);
      fs.writeFileSync(path.join(target, "b.js"), "b");
      fs.symlinkSync(target, path.join(nm, "argparse", "linked"));
      stageCloneModules({ rootDir: root, cloneDir: clone });
      const dest = path.join(clone, "node_modules");
      assert.equal(lstat(dest).isDirectory(), true);
      for (const rel of [
        "js-yaml",
        "js-yaml/lib",
        "js-yaml/lib/index.js",
        "argparse",
        "argparse/a.js",
      ]) {
        assert.equal(lstat(path.join(dest, rel)).isSymbolicLink(), false, rel);
      }
      assert.equal(lstat(path.join(dest, "argparse", "linked")).isDirectory(), true);
      assert.equal(fs.readFileSync(path.join(dest, "argparse", "linked", "b.js"), "utf8"), "b");
    },
  );

  test("every other entry, hidden ones included, is a link to the root entry", POSIX, () => {
    const { root, clone } = sandbox();
    const outcomes = stageCloneModules({ rootDir: root, cloneDir: clone });
    const nm = path.join(root, "node_modules");
    const dest = path.join(clone, "node_modules");
    assert.deepEqual(fs.readdirSync(dest).sort(), [
      ".bin",
      ".package-lock.json",
      "argparse",
      "js-yaml",
      "other",
    ]);
    for (const name of ["other", ".bin", ".package-lock.json"]) {
      assert.equal(lstat(path.join(dest, name)).isSymbolicLink(), true, name);
      assert.equal(fs.readlinkSync(path.join(dest, name)), path.join(nm, name));
    }
    assert.deepEqual(
      outcomes.map((o) => o.method),
      ["link", "link", "link"],
    );
    assert.equal(fallbackNotice(outcomes), "");
  });

  test("a refused link becomes a reported copy", () => {
    const { root, clone } = sandbox();
    const outcomes = stageCloneModules({
      rootDir: root,
      cloneDir: clone,
      platform: "win32",
      symlinkImpl: () => {
        throw Object.assign(new Error("EPERM"), { code: "EPERM" });
      },
    });
    const dest = path.join(clone, "node_modules");
    assert.equal(lstat(path.join(dest, "other")).isSymbolicLink(), false);
    assert.equal(fs.readFileSync(path.join(dest, "other", "o.js"), "utf8"), "o");
    assert.equal(
      outcomes.every((o) => o.method === "fallback-copy"),
      true,
    );
    const notice = fallbackNotice(outcomes);
    for (const name of ["other", ".bin", ".package-lock.json"]) {
      assert.ok(notice.includes(path.join(dest, name)), name);
    }
    assert.ok(!notice.includes(path.join(dest, "js-yaml")));
  });

  test("an absent source node_modules leaves an empty real directory", () => {
    const { root, clone } = sandbox();
    fs.rmSync(path.join(root, "node_modules"), { recursive: true });
    assert.deepEqual(stageCloneModules({ rootDir: root, cloneDir: clone }), []);
    assert.deepEqual(fs.readdirSync(path.join(clone, "node_modules")), []);
    assert.equal(lstat(path.join(clone, "node_modules")).isDirectory(), true);
  });
});

// Spec 0257 R14: `extensionDirs` lists what the shell glob `extensions/*/*/` lists, in byte order.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { extensionDirs } from "../lib/monorepo-release/extension-dirs.ts";

function manifest(base: string, ...parts: string[]): void {
  const dir = path.join(base, "extensions", ...parts);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), "{}\n");
}

describe("extensionDirs", () => {
  it("lists the directories two levels down in byte order", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-extdirs-test-"));
    try {
      manifest(base, "b", "two");
      manifest(base, "a", "one");
      manifest(base, "a", "Zed");
      fs.writeFileSync(path.join(base, "extensions", "a", "file.txt"), "not a directory");
      assert.deepEqual(
        extensionDirs(base).map((dir) => path.relative(base, dir)),
        [
          path.join("extensions", "a", "Zed"),
          path.join("extensions", "a", "one"),
          path.join("extensions", "b", "two"),
        ],
      );
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it("skips dot-directories at both levels, like the shell glob", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-extdirs-test-"));
    try {
      manifest(base, "core", "real");
      manifest(base, ".hidden", "x");
      manifest(base, "core", ".hidden");
      assert.deepEqual(
        extensionDirs(base).map((dir) => path.relative(base, dir)),
        [path.join("extensions", "core", "real")],
      );
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it("is empty when there is no extensions directory", () => {
    assert.deepEqual(extensionDirs(path.join(os.tmpdir(), "crewrig-no-such-dir-xyz")), []);
  });
});

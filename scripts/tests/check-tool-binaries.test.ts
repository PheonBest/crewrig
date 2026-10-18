// Tests for scripts/check-tool-binaries.ts and scripts/lib/tool-binaries.ts (spec 0266 R13).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { binaryNames, missingTools } from "../lib/tool-binaries.ts";

const checker = path.resolve(import.meta.dirname, "..", "check-tool-binaries.ts");
const roots: string[] = [];

function makeRoot(files: Record<string, number>): string {
  const root = mkdtempSync(path.join(tmpdir(), "tool-binaries-"));
  roots.push(root);
  const binDir = path.join(root, "node_modules", ".bin");
  mkdirSync(binDir, { recursive: true });
  for (const [name, mode] of Object.entries(files)) {
    writeFileSync(path.join(binDir, name), "#!/bin/sh\n");
    chmodSync(path.join(binDir, name), mode);
  }
  return root;
}

function run(root: string, args: string[]) {
  return spawnSync(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", checker, ...args],
    { encoding: "utf8", env: { ...process.env, CREWRIG_REPO_DIR: root } },
  );
}

after(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("tool binaries", () => {
  it("names the .cmd shim on Windows and the bare file elsewhere", () => {
    assert.deepEqual(binaryNames("tsc", "win32"), ["tsc.cmd", "tsc.exe"]);
    assert.deepEqual(binaryNames("tsc", "linux"), ["tsc"]);
  });

  it("accepts a .cmd shim on win32 and rejects a bare file there", () => {
    const root = makeRoot({ "tsc.cmd": 0o644, oxlint: 0o755 });
    assert.deepEqual(missingTools(root, ["tsc"], { platform: "win32" }), []);
    assert.deepEqual(missingTools(root, ["oxlint"], { platform: "win32" }), ["oxlint"]);
  });

  it("requires the execute bit on POSIX", () => {
    const root = makeRoot({ tsc: 0o755, oxlint: 0o644 });
    assert.deepEqual(missingTools(root, ["tsc", "oxlint", "oxfmt"], { platform: "linux" }), [
      "oxlint",
      "oxfmt",
    ]);
  });

  it("exits 0 when every tool is present, 1 naming the missing ones, 2 with no tool", () => {
    if (process.platform === "win32") {
      return;
    }
    const root = makeRoot({ tsc: 0o755, oxlint: 0o755 });
    assert.equal(run(root, ["tsc", "oxlint"]).status, 0);
    const failed = run(root, ["tsc", "oxfmt"]);
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /oxfmt/);
    assert.doesNotMatch(failed.stderr, /tsc/);
    assert.equal(run(root, []).status, 2);
  });
});

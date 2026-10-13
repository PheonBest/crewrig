// monorepo-release-prepare-cmd.test.ts — the exec-plugin command strings of the
// TypeScript release driver (spec 0257 R16, Decision D2).

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { prepareCmd, syncCmd } from "../lib/monorepo-release/prepare-cmd.ts";

const V = "${nextRelease.version}";

describe("prepare commands", () => {
  test("publish command syncs then packages", () => {
    assert.equal(
      prepareCmd({ root: "/ROOT", ext: "foo", out: "/ROOT/dist/release/foo", version: V }),
      `node "/ROOT/scripts/release-sync-manifests.ts" ${V} && node "/ROOT/scripts/release-package-extension.ts" foo --version ${V} --out "/ROOT/dist/release/foo"`,
    );
  });

  test("rehearsal command carries the literal version", () => {
    assert.equal(
      prepareCmd({ root: "/clone", ext: "foo", out: "/o", version: "1.2.3" }),
      `node "/clone/scripts/release-sync-manifests.ts" 1.2.3 && node "/clone/scripts/release-package-extension.ts" foo --version 1.2.3 --out "/o"`,
    );
  });

  test("prepare command is the sync alone", () => {
    assert.equal(
      syncCmd({ root: "/ROOT", version: V }),
      `node "/ROOT/scripts/release-sync-manifests.ts" ${V}`,
    );
  });

  test("a root with a space is quoted and accepted", () => {
    const cmd = syncCmd({ root: "/my root", version: "1.0.0" });
    assert.equal(cmd, 'node "/my root/scripts/release-sync-manifests.ts" 1.0.0');
  });

  test("the engine template passes through untouched", () => {
    assert.ok(
      prepareCmd({ root: "/r", ext: "e", out: "/o", version: V }).includes(`--version ${V} `),
    );
  });

  for (const [label, ch] of [
    ["double quote", '"'],
    ["percent", "%"],
    ["exclamation", "!"],
    ["dollar", "$"],
    ["backtick", "`"],
    ["backslash", "\\"],
    ["line feed", "\n"],
    ["carriage return", "\r"],
  ] as const) {
    test(`a root holding a ${label} is refused, naming it`, () => {
      const bad = `/a${ch}b`;
      assert.throws(
        () => syncCmd({ root: bad, version: "1.0.0", platform: "linux" }),
        (e: Error) => e.name === "Error" && e.message.includes(bad),
      );
    });
    test(`an out holding a ${label} is refused`, () => {
      assert.throws(
        () =>
          prepareCmd({
            root: "/r",
            ext: "e",
            out: `/o${ch}x`,
            version: "1.0.0",
            platform: "linux",
          }),
        /cannot be used/,
      );
    });
  }

  test("on win32 backslashes become forward slashes", () => {
    assert.equal(
      syncCmd({ root: "C:\\work\\rig", version: "1.0.0", platform: "win32" }),
      'node "C:/work/rig/scripts/release-sync-manifests.ts" 1.0.0',
    );
  });

  test("on win32 other shell-active characters are still refused", () => {
    assert.throws(
      () => syncCmd({ root: "C:\\wo%rk", version: "1.0.0", platform: "win32" }),
      /cannot be used/,
    );
  });

  test("a UNC path is refused naming it", () => {
    for (const unc of ["\\\\server\\share", "//server/share"]) {
      for (const platform of ["win32", "linux"] as const) {
        assert.throws(
          () => syncCmd({ root: unc, version: "1.0.0", platform }),
          (e: Error) => e.message.includes("UNC") && e.message.includes(unc),
        );
      }
    }
  });

  test("no command mentions bash or jq", () => {
    for (const cmd of [
      prepareCmd({ root: "/r", ext: "e", out: "/o", version: V }),
      syncCmd({ root: "/r", version: V }),
    ]) {
      assert.ok(!cmd.includes("bash") && !cmd.includes("jq"), cmd);
    }
  });
});

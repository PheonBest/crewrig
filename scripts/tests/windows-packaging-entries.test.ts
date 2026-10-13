// windows-packaging-entries.test.ts — runs the cross-system proof of the packaging and release entries
// (spec 0257 R27) on every platform: on Windows each entry runs through PowerShell or `cmd.exe`, on
// POSIX directly, and the same assertions hold. The `windows-packaging-entries` job runs the proof as
// its own step too. The PATH filter is also tested on simulated win32 data.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";

import { childPath, lines, toSlash } from "./lib/windows-packaging-driver.ts";

const PROOF = path.resolve(import.meta.dirname, "lib", "windows-packaging-proof.ts");

describe("windows packaging entries proof", () => {
  it("passes under PowerShell and cmd.exe (directly on POSIX)", () => {
    const env = { ...process.env };
    delete env["NODE_TEST_CONTEXT"];
    delete env["CI"];
    const res = spawnSync(
      process.execPath,
      ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", PROOF],
      { encoding: "utf8", env },
    );
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.match(res.stdout, /windows-packaging-proof: OK/);
  });
});

describe("windows packaging proof helpers (simulated win32 data)", () => {
  const GIT_BASH = "C:\\Program Files\\Git\\bin";
  const SYSTEM32 = "C:\\Windows\\System32";
  const input = (files: string[]) => ({
    platform: "win32" as const,
    systemRoot: "C:\\Windows",
    isFile: (file: string) => files.includes(file),
  });
  const parent = [
    GIT_BASH,
    "C:\\Program Files\\Git\\cmd",
    `${SYSTEM32}\\`,
    "C:\\Program Files\\nodejs",
    "",
  ].join(";");

  it("drops every directory holding a bash.exe but keeps System32, which holds the WSL one", () => {
    const files = [`${GIT_BASH}\\bash.exe`, `${SYSTEM32}\\bash.exe`];
    assert.equal(
      childPath(["D:\\stubs"], parent, input(files)),
      [
        "D:\\stubs",
        "C:\\Program Files\\Git\\cmd",
        `${SYSTEM32}\\`,
        "C:\\Program Files\\nodejs",
      ].join(";"),
    );
  });

  it("keeps the whole parent PATH off Windows, where git and sh sit next to bash", () => {
    const posix = { platform: "linux" as const, systemRoot: "", isFile: () => true };
    assert.equal(childPath(["/stubs"], "/usr/bin::/bin", posix), "/stubs:/usr/bin:/bin");
  });

  it("folds CRLF and rewrites backslashes", () => {
    assert.equal(lines("a\r\nb\r\n"), "a\nb\n");
    assert.equal(toSlash("C:\\a b\\c"), "C:/a b/c");
  });
});

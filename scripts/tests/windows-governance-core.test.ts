// windows-governance-core.test.ts — the cross-system proof of the governance checks (spec 0259 R26-R28).
// `check-agents-size.ts` runs from PowerShell on Windows against the real AGENTS.md and against a
// fixture over the threshold; off Windows it runs from the default shell so the file also passes in
// Linux CI. The interpreters are resolved from the PARENT PATH before the child PATH is narrowed.
// The `windows-governance-checks` job runs every `windows-governance-*.test.ts` file.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { defaultIsFile } from "../lib/worktree-claim/launch-windows.ts";
import { expectStatus, resolveInterpreters, spawnEntry, why } from "./lib/windows-proof-support.ts";
import type { Run } from "./lib/windows-proof-support.ts";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = path.join(repo, "scripts", "check-agents-size.ts");
const threshold = 22000;

function withBox<T>(body: (home: string, bin: string) => T): T {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "windows-governance-")),
  );
  try {
    const bin = path.join(root, "bin");
    fs.mkdirSync(bin);
    return body(root, bin);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function run(entry: string, args: string[], home: string, bin: string): Run {
  // Resolved from the parent environment, before spawnEntry narrows the child PATH.
  const interpreters = resolveInterpreters({
    platform: process.platform,
    env: process.env,
    isFile: defaultIsFile,
  });
  console.log(`windows-governance-core: ${entry}: ${interpreters.notes.join("; ")}`);
  return spawnEntry({
    entry,
    script,
    args,
    shell: "pwsh",
    env: {
      GIT_CONFIG_NOSYSTEM: "1",
      NODE_OPTIONS: "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
    },
    home,
    bin,
    interpreters,
  });
}

describe("windows governance core: check-agents-size", () => {
  it("accepts the real AGENTS.md", () => {
    withBox((home, bin) => {
      const r = run("agents-size real", [path.join(repo, "AGENTS.md")], home, bin);
      expectStatus(r, 0);
      const bytes = fs.statSync(path.join(repo, "AGENTS.md")).size;
      assert.match(
        r.out.replaceAll("\r\n", "\n"),
        new RegExp(`^OK: AGENTS\\.md is ${bytes} bytes \\(threshold: ${threshold} bytes\\)\\n$`),
        why(r, "verdict line"),
      );
      assert.equal(r.err, "", why(r, "no diagnostic"));
    });
  });

  it("rejects a file at the threshold with the two ERROR lines", () => {
    withBox((home, bin) => {
      const big = path.join(home, "AGENTS.md");
      fs.writeFileSync(big, "x".repeat(threshold));
      const r = run("agents-size over", [big], home, bin);
      expectStatus(r, 1);
      const err = r.err.replaceAll("\r\n", "\n");
      assert.match(
        err,
        new RegExp(
          `ERROR: AGENTS\\.md is ${threshold} bytes .* meets or exceeds the ${threshold}-byte threshold\\.`,
        ),
        why(r, "first diagnostic line"),
      );
      assert.match(
        err,
        /Extract more content to docs\/ to bring AGENTS\.md below 22 000 bytes\./,
        why(r, "second line"),
      );
      assert.equal(r.out, "", why(r, "no verdict on stdout"));
    });
  });

  it("reports an unreadable file with status 1", () => {
    withBox((home, bin) => {
      const r = run("agents-size missing", [path.join(home, "absent.md")], home, bin);
      expectStatus(r, 1);
      assert.match(r.err, /Error: .*absent\.md: /, why(r, "unreadable diagnostic"));
    });
  });
});

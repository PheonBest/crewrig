// e2e-docs-lock.test.ts — content guarantees of the e2e documentation and of the image lockfile
// (spec 0261 R19). Migrated from test-e2e-readme.sh, test-e2e-libs-readme.sh and
// test-e2e-versions-lock.sh. Pure file reads plus `git ls-files`; runs on Windows.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const read = (...p: string[]): string => fs.readFileSync(path.join(REPO, ...p), "utf8");
const lineCount = (text: string): number => (text.match(/\n/g) ?? []).length;
const lines = (text: string): string[] => text.split(/\r?\n/);

describe("tests/e2e/README.md", () => {
  const readme = read("tests", "e2e", "README.md");

  it("stays within the 200-line budget", () => {
    assert.ok(lineCount(readme) <= 200, `${lineCount(readme)} lines`);
  });
  for (const cli of ["claude", "gemini", "copilot"]) {
    it(`mentions ${cli}`, () => {
      assert.match(readme, new RegExp(`(^|[^a-z])${cli}([^a-z]|$)`, "im"));
    });
  }
  it("carries the PAT 90-day rotation reminder", () => {
    assert.ok(lines(readme).some((l) => /90/.test(l) && /pat|day|rotat|expir/i.test(l)));
  });
  it("documents the read-only posture without claiming every mount is read-only", () => {
    assert.match(readme, /read-only|:ro\b/i);
    assert.doesNotMatch(readme, /mounts? read-only|read-only volume mounts at scenario time/i);
    assert.match(readme, /copilot.*:rw|:rw.*copilot/i);
  });
  it("cross-references the epic or child issues", () => {
    assert.ok(["#75", "#78", "#80", "#81"].some((r) => readme.includes(r)));
  });
  it("points at lib/README.md", () => {
    assert.ok(readme.includes("lib/README.md"));
  });
});

describe("tests/e2e/lib/README.md", () => {
  const lib = read("tests", "e2e", "lib", "README.md");

  it("stays within the 200-line budget", () => {
    assert.ok(lineCount(lib) <= 200, `${lineCount(lib)} lines`);
  });
  for (const needle of ["assert.sh", "structural.sh", "llm_judge.sh"]) {
    it(`mentions ${needle}`, () => {
      assert.ok(lib.includes(needle));
    });
  }
  it("explains the ANTHROPIC_JUDGE_API_KEY separation", () => {
    assert.ok(lib.includes("ANTHROPIC_JUDGE_API_KEY"));
    assert.match(lib, /separate|accounting|isolation/);
  });
  it("documents the max_calls cap", () => {
    assert.ok(lib.includes("max_calls"));
  });
  it("flags the macOS/BSD grep caveat", () => {
    assert.match(lib, /BSD|macOS/);
  });
});

describe("docker/e2e/.versions.lock", () => {
  const rel = "docker/e2e/.versions.lock";
  const REQUIRED = [
    "captured_at",
    "base.debian",
    "base.node",
    "base.npm",
    "base.python",
    "base.pipx",
    "base.gh",
    "base.yq",
    "base.jq",
    "base.ollama",
    "claude.cli",
    "gemini.cli",
    "copilot.cli",
    "mempalace.cli",
  ];

  it("exists and is tracked by git", () => {
    assert.ok(fs.existsSync(path.join(REPO, rel)));
    const r = spawnSync("git", ["ls-files", "--error-unmatch", rel], {
      cwd: REPO,
      stdio: "ignore",
    });
    assert.equal(r.status, 0, `${rel} is not in the index`);
  });
  for (const key of REQUIRED) {
    it(`key present: ${key}`, () => {
      assert.ok(lines(read(...rel.split("/"))).some((l) => l.startsWith(`${key}=`)));
    });
  }
  it("captured_at is ISO 8601 UTC", () => {
    const line = lines(read(...rel.split("/"))).find((l) => l.startsWith("captured_at="));
    assert.match(
      line?.slice("captured_at=".length) ?? "",
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
    );
  });
});

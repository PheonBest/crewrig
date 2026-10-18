// setup-tier-staging-declared.test.ts — the build target and the staging path each setup declares
// for its library tier (spec 0256 R9). Ported from scripts/tests/test-setup-ensure-tier-built.sh
// group G4 (spec 0263, row A). The tool names and staging sub-directories stay verbatim literals:
// deriving them from the declaration would compare a value with itself. The G3 `claude` gap of the
// annex (ERROR line naming the target, staging absent after failure) is covered here against the
// TypeScript ensureTierBuilt. All platforms.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { SetupExit } from "../lib/setup/exit.ts";
import { ensureTierBuilt } from "../lib/setup/tier-build.ts";
import { SETUP_DESCRIPTORS, renderDeclaration } from "./lib/print-setup-declarations.ts";

const TABLE: readonly (readonly [string, string])[] = [
  ["gemini", ".gemini"],
  ["claude", ".claude"],
  ["copilot", ".github/skills"],
  ["antigravity", ".agents"],
];

/** First-match `key=value` fact, as the Bash `grep "^key=" | head -1 | cut -d= -f2-`. */
function fact(lines: string, key: string): string {
  const hit = lines.split("\n").find((l) => l.startsWith(`${key}=`));
  return hit === undefined ? "" : hit.slice(key.length + 1);
}

describe("declared library-tier build target and staging path", () => {
  for (const [tool, sub] of TABLE) {
    it(`${tool}: build target, library staging path and staging root`, () => {
      const descriptor = SETUP_DESCRIPTORS[tool];
      assert.ok(descriptor, `${tool}: empty declaration (vacuity guard)`);
      const declared = renderDeclaration(descriptor, "lines");
      const buildTarget = fact(declared, "tiers.build-target");
      const gate = fact(declared, "tiers.gate");
      const libraryStaging = fact(declared, "tiers.library-staging");
      assert.ok(
        buildTarget !== "" && gate !== "" && libraryStaging !== "",
        `${tool}: facts missing`,
      );
      assert.equal(buildTarget, tool);
      const staging = gate.replace("<TIER>", "library");
      assert.equal(staging, `<REPO>/dist/library/${sub}`);
      assert.ok(
        staging === libraryStaging || staging.startsWith(`${libraryStaging}/`),
        `${tool}: '${staging}' is outside the library staging root '${libraryStaging}'`,
      );
    });
  }

  it("ensureTierBuilt on a failed claude build names the target and leaves staging absent", async () => {
    const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tier-claude-")));
    const err: string[] = [];
    const staging = path.join(repo, "dist/library/.claude");
    const io = { out: () => {}, err: (l: string) => err.push(l), errRaw: () => {} };
    try {
      await assert.rejects(
        ensureTierBuilt(
          { io, env: {}, platform: process.platform, repoDir: repo },
          "claude",
          staging,
          {
            build: async () => 1,
          },
        ),
        (e: unknown) => e instanceof SetupExit && e.status === 1,
      );
      assert.ok(
        err.some((l) => /ERROR:.*claude/.test(l)),
        `no ERROR line naming claude: ${err.join("|")}`,
      );
      assert.equal(fs.existsSync(staging), false);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});

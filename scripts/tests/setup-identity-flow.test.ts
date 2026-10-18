// setup-identity-flow.test.ts — the `identity-check` step through the real runSetup flow, per CLI,
// over a mock repository (spec 0263, suite test-setup-init-command-instructions.sh groups G2 and
// G3). G1 (the declared init strings) is the table of setup-retarget-others.test.ts.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, it } from "node:test";

import type { FlowDeps, SetupDescriptor } from "../lib/setup/descriptor.ts";
import { runSetup } from "../lib/setup/flow.ts";
import { antigravityDescriptor } from "../lib/setup/cli-antigravity.ts";
import { claudeDescriptor } from "../lib/setup/cli-claude.ts";
import { copilotDescriptor } from "../lib/setup/cli-copilot.ts";
import { geminiDescriptor } from "../lib/setup/cli-gemini.ts";
import { commonSteps } from "../lib/setup/steps.ts";

const RULE = "====================================";

const CASES: readonly (readonly [string, SetupDescriptor, string, string])[] = [
  [
    "antigravity",
    antigravityDescriptor,
    'agy -i "/init-soul" --new-project',
    'agy -i "/init-personal-profile" --new-project',
  ],
  ["copilot", copilotDescriptor, 'copilot -i "/init-soul"', 'copilot -i "/init-personal-profile"'],
  ["claude", claudeDescriptor, "claude /init-soul", "claude /init-personal-profile"],
  ["gemini", geminiDescriptor, "gemini /init-soul", "gemini /init-personal-profile"],
];

describe("identity-check through runSetup", () => {
  let root: string;
  let repo: string;
  let home: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "setup-identity-"));
    repo = path.join(root, "mock-repo");
    home = path.join(root, "home");
    fs.mkdirSync(path.join(repo, "config"), { recursive: true });
    fs.mkdirSync(home, { recursive: true });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  async function run(base: SetupDescriptor): Promise<{ status: number; text: string }> {
    const stdin = new PassThrough();
    stdin.end();
    const chunks: string[] = [];
    const deps: FlowDeps = {
      argv: [],
      stdin,
      stdout: { write: (t) => void chunks.push(t) },
      stderr: { write: (t) => void chunks.push(t) },
      env: { HOME: home, USERPROFILE: home },
      platform: process.platform,
      home,
      repoDir: repo,
      steps: commonSteps,
    };
    const status = await runSetup({ ...base, steps: ["banner", "identity-check"] }, deps);
    return { status, text: chunks.join("") };
  }

  for (const [cli, descriptor, soul, profile] of CASES) {
    it(`missing identity refuses with the documented invocation: ${cli}`, async () => {
      const { status, text } = await run(descriptor);
      assert.ok(text.includes(RULE), `the flow did not run: ${text}`);
      const lines = text.split("\n");
      assert.equal(status, 1, text);
      assert.ok(lines.includes(`  - config/SOUL.md is missing — run: ${soul}`), text);
      assert.ok(lines.includes(`  - config/PROFILE.md is missing — run: ${profile}`), text);
    });
  }

  it("present identity files pass", async () => {
    fs.writeFileSync(path.join(repo, "config", "SOUL.md"), "");
    fs.writeFileSync(path.join(repo, "config", "PROFILE.md"), "");
    const { status, text } = await run(geminiDescriptor);
    assert.equal(status, 0, text);
    assert.ok(!text.includes("Cannot proceed"), text);
    assert.ok(text.includes(RULE), text);
  });
});

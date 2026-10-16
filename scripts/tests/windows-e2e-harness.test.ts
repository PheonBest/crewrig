// windows-e2e-harness.test.ts — the cross-system proof of the end-to-end harness entries (spec 0261
// R17, R20, R21): the runner dry run, toml_merge, report, the verdict publisher dry run, the docker
// diagnostics and the three probes without a vendor CLI each run as `node <entry>.ts` from PowerShell
// and from `cmd.exe` on Windows, against scratch HOME/USERPROFILE and a PATH with no docker or CLI.
// The `direct` leg runs the same assertions on any host; the shell legs skip off Windows. The
// Docker-driving scenarios and the live probes are POSIX only (R21) and are not run here.
// The `windows-e2e-harness` job runs this file.

import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

import { defaultIsFile } from "../lib/worktree-claim/launch-windows.ts";
import {
  dockerless,
  probesWithoutCli,
  publishDryRun,
  reportCli,
  runnerDryRun,
  tomlMergeCli,
} from "./lib/windows-e2e-cases.ts";
import { inProcess } from "./lib/windows-e2e-inproc.ts";
import { makeCtx, noCarriageReturn } from "./lib/windows-e2e-run.ts";
import type { Leg } from "./lib/windows-e2e-run.ts";
import { resolveInterpreters, WIN } from "./lib/windows-proof-support.ts";

/** Run every case on one leg; the failures come back with their command, stdout and stderr. */
function runLeg(leg: Leg): string[] {
  const interpreters = resolveInterpreters({
    platform: process.platform,
    env: process.env,
    isFile: defaultIsFile,
  });
  console.log(`windows-e2e-harness: ${leg}: ${interpreters.notes.join("; ")}`);
  const c = makeCtx(leg, interpreters);
  try {
    for (const cases of [
      runnerDryRun,
      tomlMergeCli,
      reportCli,
      publishDryRun,
      dockerless,
      probesWithoutCli,
    ])
      cases(c);
    if (leg === "direct") inProcess(c);
    noCarriageReturn(c);
    return c.failures;
  } finally {
    fs.rmSync(c.root, { recursive: true, force: true });
  }
}

describe("windows e2e harness proof", () => {
  const legs: [Leg, string][] = [
    ["direct", "node runs each entry directly (any host)"],
    ["pwsh", "each entry runs from PowerShell"],
    ["cmd", "each entry runs from cmd.exe"],
  ];
  for (const [leg, title] of legs)
    it(title, { skip: leg !== "direct" && !WIN }, () => {
      const failures = runLeg(leg);
      assert.deepEqual(failures, [], failures.map((f, i) => `${i + 1}. ${f}`).join("\n"));
    });
});

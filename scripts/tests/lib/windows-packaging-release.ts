// windows-packaging-release.ts — the release driver cases of the cross-system proof (spec 0257 R27:
// `wp-driver-refusals`, `wp-driver-rehearsal`). The driver runs in the hermetic sandbox of
// `release-driver-sandbox.ts`, whose capturing stubs replace the engine and the forge CLI.
//
// REAL_ENGINE: the plan leaves open whether the rehearsal runs the real semantic-release engine on
// the Windows runner ("Open question: real engine or stub"). It is `false`: the sandbox copy of
// `release-rehearse.mjs` is the capturing stub (the production file is never touched, no seam), so
// the proof does not depend on the engine's own Windows behaviour or on a 10 minute run. The
// driver's own `prepareCmd` still runs for real, through `cmd.exe` on win32, from a root and a
// temporary directory whose names hold a space. Flip it only to measure the real engine by hand.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  GITHUB_ENV,
  GITLAB_ENV,
  findNamed,
  pluginsNamed,
  rehearseConfig,
  scriptHelloWorldPublish,
} from "./release-blackbox-helpers.ts";
import { createReleaseSandbox } from "./release-driver-sandbox.ts";
import type { ReleaseSandbox } from "./release-driver-sandbox.ts";
import {
  assertNoBash,
  attempt,
  baseEnv,
  childPath,
  runEntry,
  toSlash,
  writeBins,
} from "./windows-packaging-driver.ts";
import type { Proof } from "./windows-packaging-driver.ts";
import { expectStatus, why } from "./windows-proof-support.ts";
import type { Run } from "./windows-proof-support.ts";

/** See the header: the production engine is not run by this proof. */
export const REAL_ENGINE = false;

const BRANCH_REFUSAL =
  "Error: not a branch pipeline (merge-request or tag): run the release from a branch pipeline";

function driverEnv(
  sb: ReleaseSandbox,
  binDir: string,
  tmp: string,
  extra: Record<string, string>,
): Record<string, string> {
  const base = sb.env(extra);
  const pathValue = childPath([binDir], base["PATH"] ?? "", {
    platform: process.platform,
    systemRoot: process.env["SystemRoot"] ?? "C:\\Windows",
    isFile: (file) => fs.existsSync(file),
  });
  return { ...base, ...baseEnv(pathValue, base["HOME"] ?? tmp, tmp, extra) };
}

function runDriver(proof: Proof, root: string, env: Record<string, string>): Run {
  return runEntry({
    script: path.join(root, "scripts", "monorepo-release.ts"),
    args: [],
    cwd: root,
    shell: "pwsh",
    env,
    interpreters: proof.interpreters,
  });
}

function refusalCases(proof: Proof, tmp: string): void {
  const sb = createReleaseSandbox();
  const bins = writeBins(path.join(tmp, "refusal-bin"), false);
  try {
    const cases: readonly [string, Record<string, string>, string][] = [
      ["gitea", { GITEA_ACTIONS: "true" }, "Error: unsupported release forge: gitea"],
      [
        "ambiguous",
        { GITHUB_ACTIONS: "true", GITLAB_CI: "true" },
        "Error: unsupported release forge: ambiguous (github+gitlab)",
      ],
      ["none", {}, "Error: unsupported release forge: none (not a CI environment)"],
      ["unknown-ci", { CI: "true" }, "Error: unsupported release forge: unknown CI"],
      [
        "invalid-canonical",
        { ...GITHUB_ENV, RELEASE_DRY_RUN: "maybe" },
        "Error: invalid RELEASE_DRY_RUN value (expected true, false or empty)",
      ],
      [
        "invalid-alias",
        { ...GITHUB_ENV, DRY_RUN: "1" },
        "Error: invalid DRY_RUN value (expected true, false or empty)",
      ],
      [
        "gitlab-merge-request",
        { ...GITLAB_ENV, CI_PIPELINE_SOURCE: "merge_request_event" },
        BRANCH_REFUSAL,
      ],
    ];
    attempt(proof, "wp-driver-refusals", () => {
      for (const [name, extra, message] of cases) {
        const res = runDriver(proof, sb.root, driverEnv(sb, bins.dir, tmp, extra));
        expectStatus(res, 2);
        assert.ok(res.err.split("\n").includes(message), why(res, `${name}: exact refusal text`));
        assert.deepEqual(sb.readJsonl("npx").concat(sb.readJsonl("rehearse")), [], name);
        assert.deepEqual(findNamed(sb.root, ".releaserc.json"), [], `${name}: no config written`);
      }
      assertNoBash(bins);
    });
  } finally {
    sb.dispose();
  }
}

function rehearsalCase(proof: Proof, tmp: string): void {
  const sb = createReleaseSandbox();
  const bins = writeBins(path.join(tmp, "rehearsal-bin"), false);
  const spaced = path.join(tmp, "dir with space");
  fs.mkdirSync(spaced, { recursive: true });
  const scratchParent = path.join(spaced, "temp dir");
  fs.mkdirSync(scratchParent);
  const root = path.join(spaced, "checkout");
  try {
    scriptHelloWorldPublish(sb);
    // The sandbox root has no space: move it, git and all (its origin is an absolute path elsewhere).
    fs.renameSync(sb.root, root);
    attempt(proof, "wp-driver-rehearsal", () => {
      const extra = { ...GITHUB_ENV, RELEASE_DRY_RUN: "true" };
      const res = runDriver(proof, root, driverEnv(sb, bins.dir, scratchParent, extra));
      expectStatus(res, 0);
      const line =
        /^REHEARSAL hello-world version=\S+ tag=\S+ baseline=\S+ archive=(hello-world-\S+\.tar\.gz) sha256=([0-9a-f]{64})$/m;
      const verdict = line.exec(res.out);
      assert.ok(verdict !== null, why(res, "the REHEARSAL line, with an archive and its digest"));
      assert.match(res.out, /^Mode: rehearsal$/m, why(res, "mode line"));
      assert.deepEqual(sb.readJsonl("npx"), [], "a rehearsal never starts npx");

      // The prepare command the driver handed the exec plugin: forward slashes only, the clone
      // root and the output directory under the temporary directory with a space.
      const config = rehearseConfig(sb, "hello-world");
      const exec = pluginsNamed(config, "@semantic-release/exec")[0];
      const cmd = String(exec?.[1]["prepareCmd"]);
      const shape =
        /^node "([^"]+)\/scripts\/release-sync-manifests\.ts" (\S+) && node "\1\/scripts\/release-package-extension\.ts" hello-world --version \2 --out "([^"]+)"$/;
      const parts = shape.exec(cmd);
      assert.ok(parts !== null, `prepareCmd does not have the expected shape: ${cmd}`);
      const [, cloneRoot = "", , out = ""] = parts;
      assert.ok(!cmd.includes("\\"), `prepareCmd holds a backslash: ${cmd}`);
      const scratch = toSlash(scratchParent);
      assert.ok(cloneRoot.startsWith(`${scratch}/`), `${cloneRoot} is not under ${scratch}`);
      assert.ok(out.startsWith(`${scratch}/`), `${out} is not under ${scratch}`);
      assert.ok(/^([A-Za-z]:)?\//.test(cloneRoot), `${cloneRoot} is not absolute`);
      proof.landed.push({
        label: "the rehearsal configuration",
        bytes: Buffer.from(JSON.stringify(config)),
      });
      assertNoBash(bins);
    });
  } finally {
    sb.dispose();
    fs.rmSync(spaced, { recursive: true, force: true });
  }
}

/** Run the release driver cases. */
export function runDriverCases(proof: Proof, tmp: string): void {
  refusalCases(proof, tmp);
  rehearsalCase(proof, tmp);
}

// release-flow-ctx.ts — a `ReleaseCtx` over a throw-away root for the flow tests (spec 0257 R14):
// the output channels collect into arrays, the scratch directory lives in the same temporary tree.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ReleaseCtx } from "../../lib/monorepo-release/context.ts";
import { createScratch } from "../../lib/monorepo-release/scratch.ts";

export interface FlowHarness {
  readonly ctx: ReleaseCtx;
  readonly root: string;
  readonly stdout: string[];
  readonly stderr: string[];
  readonly raw: string[];
  readonly rawErr: string[];
  /** Creates `extensions/<group>/<name>/package.json` under `base` (the root by default). */
  addExtension(group: string, name: string, base?: string): string;
  dispose(): void;
}

export interface FlowHarnessOptions {
  readonly forge?: "github" | "gitlab";
  readonly env?: Record<string, string | undefined>;
  readonly aborted?: () => boolean;
}

const SCRIPTS_DIR = path.resolve(import.meta.dirname, "../..");

export function makeFlowHarness(opts: FlowHarnessOptions = {}): FlowHarness {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-flow-test-"));
  const root = path.join(tmp, "root");
  fs.mkdirSync(root);
  const stdout: string[] = [];
  const stderr: string[] = [];
  const raw: string[] = [];
  const rawErr: string[] = [];
  const forge = opts.forge ?? "gitlab";
  const scratch = createScratch({ parent: tmp });
  const ctx: ReleaseCtx = {
    forge,
    mode: "publish",
    branch: "main",
    rootDir: root,
    scriptsDir: SCRIPTS_DIR,
    env: {
      CI_PROJECT_URL: "https://gitlab.example/g/p",
      CI_SERVER_URL: "https://gitlab.example",
      GITHUB_SERVER_URL: "https://github.example",
      GITHUB_REPOSITORY: "o/r",
      PATH: process.env["PATH"],
      ...opts.env,
    },
    platform: process.platform,
    out: (line) => stdout.push(line),
    err: (line) => stderr.push(line),
    outRaw: (chunk) => raw.push(chunk),
    errRaw: (chunk) => rawErr.push(chunk),
    scratch,
    errors: 0,
    aborted: opts.aborted ?? (() => false),
  };
  return {
    ctx,
    root,
    stdout,
    stderr,
    raw,
    rawErr,
    addExtension(group, name, base = root): string {
      const dir = path.join(base, "extensions", group, name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "package.json"), "{}\n");
      return dir;
    },
    dispose(): void {
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  };
}

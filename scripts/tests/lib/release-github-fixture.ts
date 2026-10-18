// release-github-fixture.ts — the fake mirror, engine, git and `release-pr.ts` shared by the suites
// of the GitHub release-PR flow (spec 0257 R14).

import fs from "node:fs";
import path from "node:path";

import type { RehearseOptions } from "../../lib/monorepo-release/engine.ts";
import { realDeps } from "../../lib/monorepo-release/flow-deps.ts";
import type { FlowDeps } from "../../lib/monorepo-release/flow-deps.ts";
import { makeFlowHarness } from "./release-flow-ctx.ts";
import type { FlowHarness } from "./release-flow-ctx.ts";

interface Outcome {
  status?: number;
  json?: unknown;
  /** The engine's log: written to the log file only when given. */
  log?: string;
}

export interface Behaviour {
  /** The committed version of the clone's package.json. */
  manifest?: string;
  classify?: Outcome;
  prepare?: Outcome;
}

export const NEXT = { released: true, version: "1.1.0", gitTag: "alpha-v1.1.0", notes: "## 1.1.0" };

export interface Run {
  readonly h: FlowHarness;
  readonly engine: RehearseOptions[];
  readonly git: Array<{ args: readonly string[]; cwd?: string }>;
  readonly sync: Array<{ argv: readonly string[]; cwd: string; scriptsDir: string }>;
  readonly published: string[];
  readonly deps: FlowDeps;
}

interface Knobs {
  gitFails?: string;
  syncStatus?: number;
  env?: Record<string, string | undefined>;
  aborted?: () => boolean;
}

let harness: FlowHarness | undefined;
/** Registered by each suite as its `afterEach`. */
export function disposeHarness(): void {
  harness?.dispose();
}

export function setup(behaviours: Record<string, Behaviour>, knobs: Knobs = {}): Run {
  const h = makeFlowHarness({
    forge: "github",
    env: knobs.env ?? {},
    ...(knobs.aborted === undefined ? {} : { aborted: knobs.aborted }),
  });
  harness = h;
  const engine: RehearseOptions[] = [];
  const git: Run["git"] = [];
  const sync: Run["sync"] = [];
  const published: string[] = [];
  const deps: FlowDeps = {
    ...realDeps,
    makeMirror: (opts) => {
      for (const [ext, behaviour] of Object.entries(behaviours)) {
        const dir = h.addExtension("core", ext, path.join(opts.dir, "clone"));
        fs.writeFileSync(
          path.join(dir, "package.json"),
          JSON.stringify({ version: behaviour.manifest ?? "1.0.0" }),
        );
        // The checkout holds the same extension, which is where a publish runs.
        h.addExtension("core", ext);
      }
    },
    stageCloneModules: () => [],
    sha256File: () => "sha",
    runSemanticRelease: (opts) => {
      published.push(opts.dir);
      return Promise.resolve({ status: 0, output: "" });
    },
    runRehearse: (opts) => {
      engine.push(opts);
      const behaviour = behaviours[path.basename(opts.dir)] ?? {};
      const run = opts.apply ? behaviour.prepare : behaviour.classify;
      opts.stderr("engine log\n");
      if (opts.logFile !== undefined && run?.log !== undefined) {
        fs.writeFileSync(opts.logFile, run.log);
      }
      return Promise.resolve({
        status: run?.status ?? 0,
        json: JSON.stringify(run?.json ?? { released: false }),
      });
    },
    runGit: (args, opts) => {
      git.push({ args, ...(opts.cwd === undefined ? {} : { cwd: opts.cwd }) });
      const failed = knobs.gitFails !== undefined && args.includes(knobs.gitFails);
      return { status: failed ? 1 : 0, stdout: "", stderr: "" };
    },
    runReleasePr: (argv, opts) => {
      sync.push({ argv, cwd: opts.cwd, scriptsDir: opts.scriptsDir });
      return Promise.resolve(knobs.syncStatus ?? 0);
    },
  };
  return { h, engine, git, sync, published, deps };
}

export const entriesOf = (h: FlowHarness): string =>
  fs.readFileSync(path.join(h.ctx.scratch.dir, "release-pr", "entries.json"), "utf8");

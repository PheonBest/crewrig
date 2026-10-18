// engine.ts — the two ways the driver starts the release engine (spec 0257 R14, R18).
//
// `runSemanticRelease` is the publish leg: the engine itself, its output teed to the driver's
// stdout and to a log the classifier reads afterwards. `runRehearse` runs the rehearsal helper
// (`release-rehearse.mjs`), whose stdout is the JSON verdict and whose stderr is the engine log.

import fs from "node:fs";
import path from "node:path";

import { spawnCapture, spawnTee } from "./spawn.ts";

export interface SemanticReleaseOptions {
  readonly dir: string;
  readonly branch: string;
  readonly releasercPath: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly logFile: string;
  readonly out: (chunk: string) => void;
  readonly platform?: NodeJS.Platform;
}

export function runSemanticRelease(
  opts: SemanticReleaseOptions,
): Promise<{ status: number; output: string }> {
  return spawnTee(
    [
      "npx",
      "semantic-release",
      "--branches",
      opts.branch,
      "--extends",
      `semantic-release-monorepo,${opts.releasercPath}`,
    ],
    {
      cwd: opts.dir,
      env: opts.env,
      out: opts.out,
      logFile: opts.logFile,
      // The configuration lives under the checkout, which may sit in a path with spaces.
      allowSpaces: true,
      ...(opts.platform === undefined ? {} : { platform: opts.platform }),
    },
  );
}

export interface RehearseOptions {
  readonly dir: string;
  readonly libDir: string;
  readonly branch: string;
  readonly releasercPath: string;
  readonly apply: boolean;
  /** Already stripped of forge credentials. */
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stderr: (chunk: string) => void;
  readonly logFile?: string;
}

export function runRehearse(opts: RehearseOptions): Promise<{ status: number; json: string }> {
  const argv = [
    process.execPath,
    path.join(opts.libDir, "release-rehearse.mjs"),
    opts.branch,
    opts.releasercPath,
    ...(opts.apply ? ["apply"] : []),
  ];
  const { logFile } = opts;
  return spawnCapture(argv, {
    cwd: opts.dir,
    env: opts.env,
    allowSpaces: true,
    stderr: (chunk) => {
      if (logFile !== undefined) fs.appendFileSync(logFile, chunk);
      opts.stderr(chunk);
    },
  }).then(({ status, stdout }) => ({ status, json: stdout }));
}

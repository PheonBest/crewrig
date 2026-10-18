// flow-deps.ts — the seams of the publish and rehearsal flows (spec 0257 R14). Every flow takes a
// `FlowDeps` as its last parameter, so a test substitutes the engine, the mirror and the digest
// without a network, a real git history or a release engine.

import path from "node:path";

import { sha256File } from "../packaging/digest.ts";
import { git } from "../sync-from-upstream/git.ts";
import type { GitResult } from "../sync-from-upstream/git.ts";
import { stageCloneModules } from "./clone-modules.ts";
import { runRehearse, runSemanticRelease } from "./engine.ts";
import { makeMirror } from "./mirror.ts";
import { prepareCmd } from "./prepare-cmd.ts";
import { spawnInherit } from "./spawn.ts";

type ChildEnv = Readonly<Record<string, string | undefined>>;

/** Run the sync of `release-pr.ts`, which inherits the driver's stdio; resolves to its exit status. */
function spawnReleasePr(
  argv: readonly string[],
  opts: { cwd: string; env: ChildEnv; scriptsDir: string },
): Promise<number> {
  // No shell: the arguments are branch names and a path, passed as separate argv entries.
  return spawnInherit(
    [
      process.execPath,
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      path.join(opts.scriptsDir, "release-pr.ts"),
      ...argv,
    ],
    { cwd: opts.cwd, env: opts.env },
  );
}

export interface FlowDeps {
  runSemanticRelease: typeof runSemanticRelease;
  runRehearse: typeof runRehearse;
  makeMirror: typeof makeMirror;
  stageCloneModules: typeof stageCloneModules;
  sha256File: (file: string) => string;
  /** Git in the checkout: the release branch's fetch and push (never run in the clone). */
  runGit: (args: readonly string[], opts: { cwd?: string; env: ChildEnv }) => GitResult;
  /** `release-pr.ts <args>`: opens, updates or closes the release PR; resolves to its exit status. */
  runReleasePr: (
    argv: readonly string[],
    opts: { cwd: string; env: ChildEnv; scriptsDir: string },
  ) => Promise<number>;
  /** The command string the rehearsal runs as the exec plugin would; tests substitute a harmless one. */
  prepareCommand?: typeof prepareCmd;
}

export const realDeps: FlowDeps = {
  runSemanticRelease,
  runRehearse,
  makeMirror,
  stageCloneModules,
  sha256File,
  runGit: (args, opts) => git(args, opts),
  runReleasePr: spawnReleasePr,
  prepareCommand: prepareCmd,
};

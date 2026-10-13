// flow-deps.ts — the seams of the publish and rehearsal flows (spec 0257 R14). Every flow takes a
// `FlowDeps` as its last parameter, so a test substitutes the engine, the mirror and the digest
// without a network, a real git history or a release engine.

import { sha256File } from "../packaging/digest.ts";
import { stageCloneModules } from "./clone-modules.ts";
import { runRehearse, runSemanticRelease } from "./engine.ts";
import { makeMirror } from "./mirror.ts";
import { prepareCmd } from "./prepare-cmd.ts";

export interface FlowDeps {
  runSemanticRelease: typeof runSemanticRelease;
  runRehearse: typeof runRehearse;
  makeMirror: typeof makeMirror;
  stageCloneModules: typeof stageCloneModules;
  sha256File: (file: string) => string;
  /** The command string the rehearsal runs as the exec plugin would; tests substitute a harmless one. */
  prepareCommand?: typeof prepareCmd;
}

export const realDeps: FlowDeps = {
  runSemanticRelease,
  runRehearse,
  makeMirror,
  stageCloneModules,
  sha256File,
  prepareCommand: prepareCmd,
};

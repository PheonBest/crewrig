// clone-modules.ts — the clone's `node_modules` (spec 0254 delta-01 R30, spec 0257 R17, Decision D4).
// The TypeScript builders that the packaging step reaches load js-yaml only from a REAL copy under
// the root's own `node_modules` (spec 0240 R7 refuses a symbolic link), so the clone's directory is
// real: real copies of the production closure of js-yaml, a link to every other entry. A refused
// link becomes a copy and is reported, never a failure.

import fs from "node:fs";

import { copyTreeDereferenced } from "../extension/tree-copy.ts";
import { linkOrCopy, summarizeFallbacks } from "../link-or-copy.ts";
import type { LinkOutcome, LinkOrCopyOptions } from "../link-or-copy.ts";
import { joinPath } from "../paths.ts";

/** The production closure of js-yaml: always real copies, never links. */
const REAL_COPIES: ReadonlySet<string> = new Set(["js-yaml", "argparse"]);

export interface CloneModulesOptions {
  readonly rootDir: string;
  readonly cloneDir: string;
  /** Test seams of `linkOrCopy`: force a refused link. */
  readonly platform?: NodeJS.Platform;
  readonly symlinkImpl?: LinkOrCopyOptions["symlinkImpl"];
}

/** Stage `<clone>/node_modules`; returns the link outcomes (real copies are not outcomes). */
export function stageCloneModules(opts: CloneModulesOptions): LinkOutcome[] {
  const source = joinPath(opts.rootDir, "node_modules");
  const dest = joinPath(opts.cloneDir, "node_modules");
  fs.mkdirSync(dest);
  if (!fs.existsSync(source)) return [];
  const linkOpts: LinkOrCopyOptions = {
    onRefusal: "copy",
    ...(opts.platform === undefined ? {} : { platform: opts.platform }),
    ...(opts.symlinkImpl === undefined ? {} : { symlinkImpl: opts.symlinkImpl }),
  };
  const outcomes: LinkOutcome[] = [];
  // readdirSync lists hidden entries (.bin, .package-lock.json) and never `.` or `..`.
  for (const name of fs.readdirSync(source)) {
    const from = joinPath(source, name);
    const to = joinPath(dest, name);
    // `[ -e ] || [ -L ]` kept a dangling link and `ln -s` recreated it; a link whose target is gone
    // has nothing to resolve or copy, and nothing in it can be loaded, so it is left out.
    if (!fs.existsSync(from)) continue;
    if (REAL_COPIES.has(name)) copyTreeDereferenced(from, to);
    else outcomes.push(linkOrCopy(from, to, linkOpts));
  }
  return outcomes;
}

/** The one stderr notice for the entries that became copies; `""` when every link held. */
export function fallbackNotice(outcomes: readonly LinkOutcome[]): string {
  return summarizeFallbacks(outcomes);
}

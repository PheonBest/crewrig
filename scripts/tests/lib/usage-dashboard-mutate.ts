// usage-dashboard-mutate.ts — the mutation helper of the usage dashboard suite (case 13.20 of
// test-usage-dashboard.sh, spec 0260 row J1a). `mutateCopy` copies what git tracks under `scripts/`,
// `schemas/` and the optional `model-prices.org.json` to a temporary directory, links the checkout's
// `node_modules` into it, applies ONE text edit and throws when the anchor matches nothing or changes
// nothing (the Bash suite failed loudly on a stale perl anchor too). A tracked file is never edited.

import fs from "node:fs";
import path from "node:path";

import { applyMutation, copyTracked, trackedFiles, type MutationCopy } from "./mutation-copy.ts";
import { REPO as CHECKOUT } from "./worktree-fixtures.ts";

export type { MutationCopy };

const OPTIONAL = "model-prices.org.json";

export function mutateCopy(
  rel: string,
  regex: RegExp,
  repl: string,
  repo: string = CHECKOUT,
): MutationCopy {
  const pathspecs = ["scripts", "schemas"];
  if (trackedFiles(repo, [OPTIONAL]).length > 0 && fs.existsSync(path.join(repo, OPTIONAL))) {
    pathspecs.push(OPTIONAL);
  }
  const copy = copyTracked(repo, pathspecs, { linkNodeModules: true });
  try {
    applyMutation(copy, rel, regex, repl);
  } catch (e) {
    copy.dispose();
    throw e;
  }
  return copy;
}

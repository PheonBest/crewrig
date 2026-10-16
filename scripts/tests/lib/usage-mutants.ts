// usage-mutants.ts — thin wrapper of mutation-copy.ts shared by the usage-storage and
// usage-attribution suites (spec 0260): a temp copy of the usage-store tree on which
// a mutation is applied. A missing marker throws; no tracked file is ever edited.

import { applyMutation, copyTracked, type MutationCopy } from "./mutation-copy.ts";
import { REPO } from "./worktree-fixtures.ts";

export const USAGE_PATHSPECS = [
  "scripts/lib/usage-store",
  "scripts/lib/usage-record-validator.js",
  "scripts/usage-query.ts",
  "scripts/usage-prune.ts",
  "scripts/lib/usage-wrapper.ts",
  "schemas/usage-record",
];

/** Copy the usage-store tree (plus what the entries load), node_modules linked. */
export function copyLibTree(extra: readonly string[] = []): MutationCopy {
  return copyTracked(REPO, [...USAGE_PATHSPECS, ...extra], { linkNodeModules: true });
}

/** A copy with one mutation applied to `file` (relative to the copy root). */
export function mutated(file: string, needle: string | RegExp, replacement: string): MutationCopy {
  const copy = copyLibTree();
  try {
    applyMutation(copy, file, needle, replacement);
  } catch (error) {
    copy.dispose();
    throw error;
  }
  return copy;
}

export { applyMutation };

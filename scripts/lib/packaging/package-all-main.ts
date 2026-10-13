// package-all-main.ts — `package-extensions`: package every upstream extension (spec 0257 R12).
// Replaced the shell script of the same name (scripts/package-extensions.sh, now a forwarding shim): tiers core and library, plus org when `--include-org` is
// the first argument or `INCLUDE_ORG` is non-empty; each directory in byte order is packaged as a
// `package-extension` run, and the first failure ends the run with its status (the shell's
// `set -e`).

import { repoDirOf } from "../extension/entry-ctx.ts";
import type { EntryInput } from "../extension/entry-ctx.ts";
import { main as packageOne } from "./package-one-main.ts";
import { listTier } from "./tiers.ts";
import type { Tier } from "./tiers.ts";

/** Run `package-extensions`; returns its exit status. */
export async function main(input: EntryInput): Promise<number> {
  const repoDir = repoDirOf(input.entryFile);
  const tiers: Tier[] = ["core", "library"];
  if (input.argv[0] === "--include-org" || (input.env.INCLUDE_ORG ?? "") !== "") {
    tiers.push("org");
  }
  for (const tier of tiers) {
    for (const dir of listTier(repoDir, tier)) {
      // The shell ran `EXT=<dir> bash package-extension.sh`: the variable reaches that one run only.
      const status = await packageOne({
        ...input,
        argv: [],
        env: { ...input.env, EXT: dir },
      });
      if (status !== 0) return status;
    }
  }
  return 0;
}

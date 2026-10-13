// sync-manifests-main.ts — the `release-sync-manifests <version>` command (spec 0257 R16, D2).
// The engine's `prepare` step runs it in the extension directory, so the working directory is
// the one to synchronise. Returns the exit status and never exits the process.

import type { Io } from "../extension/types.ts";
import { syncManifests } from "./sync-manifests.ts";

const USAGE = "Usage: release-sync-manifests <version>";

/** Run `release-sync-manifests`; returns its exit status. */
export async function main(input: {
  argv: readonly string[];
  cwd: string;
  io: Io;
}): Promise<number> {
  const [version, ...extra] = input.argv;
  // An empty version would blank every manifest; `jq --arg v ""` would have accepted it.
  if (version === undefined || version === "" || extra.length > 0) {
    input.io.err(USAGE);
    return 1;
  }
  try {
    syncManifests(input.cwd, version);
  } catch (error) {
    input.io.err(`Error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  return 0;
}

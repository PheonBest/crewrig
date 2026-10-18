// tool-binaries.ts — locate the repository-local npm tool binaries a Taskfile precondition needs.
//
// Replaces the POSIX `test -x node_modules/.bin/<tool>` precondition (spec 0266 R13): the check
// runs in Node, so it behaves the same on Windows, where npm installs `<tool>.cmd` shims instead of
// executable files.

import { accessSync, constants, statSync } from "node:fs";
import path from "node:path";

export interface BinaryProbe {
  platform: NodeJS.Platform;
}

/** The file names npm writes under `node_modules/.bin` for one tool on the given platform. */
export function binaryNames(tool: string, platform: NodeJS.Platform): string[] {
  return platform === "win32" ? [`${tool}.cmd`, `${tool}.exe`] : [tool];
}

function isUsable(file: string, platform: NodeJS.Platform): boolean {
  try {
    if (!statSync(file).isFile()) {
      return false;
    }
    if (platform !== "win32") {
      accessSync(file, constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

/** The tools of `tools` that have no usable binary under `<root>/node_modules/.bin`. */
export function missingTools(
  root: string,
  tools: readonly string[],
  probe: BinaryProbe = { platform: process.platform },
): string[] {
  const binDir = path.join(root, "node_modules", ".bin");
  return tools.filter(
    (tool) =>
      !binaryNames(tool, probe.platform).some((name) =>
        isUsable(path.join(binDir, name), probe.platform),
      ),
  );
}

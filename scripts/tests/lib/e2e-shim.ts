// e2e-shim.ts — tells a differential test whether an end-to-end `.sh` is still a shell
// implementation or has become a forwarding shim to its TypeScript twin (spec 0261 R10, R14, R16).
// A shim has no shell behaviour to compare with: the recorded goldens are the oracle then.

import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const MAX_SHIM_LINES = 25;

/** True when the file has at most 25 lines and a line starting with `exec node`; false if missing. */
export function isForwardingShim(absOrRepoRelPath: string): boolean {
  const abs = path.isAbsolute(absOrRepoRelPath)
    ? absOrRepoRelPath
    : path.join(REPO_ROOT, absOrRepoRelPath);
  let text: string;
  try {
    text = fs.readFileSync(abs, "utf8");
  } catch {
    return false;
  }
  const lines = text.replace(/\n$/, "").split("\n");
  return lines.length <= MAX_SHIM_LINES && lines.some((l) => l.startsWith("exec node"));
}

/** A stated skip reason when the shell file is a forwarding shim, else `false`. */
export function shellLegSkipReason(absPath: string): string | false {
  return isForwardingShim(absPath)
    ? "the .sh is a forwarding shim: the recorded goldens are the oracle once the shell implementation is gone"
    : false;
}

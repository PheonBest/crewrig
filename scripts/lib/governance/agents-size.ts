// agents-size.ts — AGENTS.md size guard logic (spec 0259; replaces the logic of
// scripts/check-agents-size.sh).
//
// Usage: evaluateSize(path) -> { code, stdout, stderr }
// Threshold 19100 bytes; a size greater than or equal to it fails (`-ge`).
// Bytes are `fs.statSync().size`, never a character count.
// Exit codes: 0 under the threshold, 1 at or over it or the file is unreadable.
// Finding-line format: the two historical ERROR lines on stderr, one OK line on
// stdout, unchanged from the shell script. Deviation (d): an unreadable file
// prints ONE `Error: <path>: <reason>` line on stderr (the shell printed bash's
// own redirection diagnostic).

import { statSync } from "node:fs";

export const THRESHOLD = 19100;

export interface SizeOutcome {
  code: 0 | 1;
  stdout: string;
  stderr: string;
}

function reason(err: unknown): string {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "ENOENT") return "No such file or directory";
  if (code === "EACCES") return "Permission denied";
  if (code === "EISDIR") return "Is a directory";
  return err instanceof Error ? err.message : String(err);
}

export function evaluateSize(file: string): SizeOutcome {
  let size: number;
  try {
    const st = statSync(file);
    if (st.isDirectory()) throw Object.assign(new Error("Is a directory"), { code: "EISDIR" });
    size = st.size;
  } catch (err) {
    return { code: 1, stdout: "", stderr: `Error: ${file}: ${reason(err)}\n` };
  }
  if (size >= THRESHOLD) {
    return {
      code: 1,
      stdout: "",
      stderr:
        `ERROR: AGENTS.md is ${size} bytes — meets or exceeds the ${THRESHOLD}-byte threshold.\n` +
        "Extract more content to docs/ to bring AGENTS.md below 19 100 bytes.\n",
    };
  }
  return {
    code: 0,
    stdout: `OK: AGENTS.md is ${size} bytes (threshold: ${THRESHOLD} bytes)\n`,
    stderr: "",
  };
}

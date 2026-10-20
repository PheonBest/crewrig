// rules-size.ts — always-loaded rules budget guard logic (spec 0270 R10-R11).
//
// Usage: evaluateRulesSize(dir) -> { code, stdout, stderr }
// Sums the byte size of every `*.md` file directly inside `dir` (the core rules
// that setup deploys to every CLI). Budget 27800 bytes; a total greater than or
// equal to it fails. Bytes are `fs.statSync().size`, never a character count.
// Fail closed: an unreadable directory, or a directory without any `.md` file,
// exits 1.
// Exit codes: 0 under the budget, 1 at or over it, unreadable, or empty.

import { readdirSync, statSync } from "node:fs";
import path from "node:path";

export const BUDGET = 27800;

export interface SizeOutcome {
  code: 0 | 1;
  stdout: string;
  stderr: string;
}

function reason(err: unknown): string {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "ENOENT") return "No such directory";
  if (code === "EACCES") return "Permission denied";
  if (code === "ENOTDIR") return "Not a directory";
  return err instanceof Error ? err.message : String(err);
}

export function evaluateRulesSize(dir: string): SizeOutcome {
  let total = 0;
  let count = 0;
  try {
    for (const entry of readdirSync(dir).sort()) {
      if (!entry.endsWith(".md")) continue;
      const st = statSync(path.join(dir, entry));
      if (!st.isFile()) continue;
      total += st.size;
      count += 1;
    }
  } catch (err) {
    return { code: 1, stdout: "", stderr: `Error: ${dir}: ${reason(err)}\n` };
  }
  if (count === 0) {
    return { code: 1, stdout: "", stderr: `Error: ${dir}: no .md rules file found\n` };
  }
  if (total >= BUDGET) {
    return {
      code: 1,
      stdout: "",
      stderr:
        `ERROR: core rules total ${total} bytes — meets or exceeds the ${BUDGET}-byte budget.\n` +
        "Extract more content to docs/ to bring artifacts/core/rules/*.md below the budget.\n",
    };
  }
  return {
    code: 0,
    stdout: `OK: core rules total ${total} bytes across ${count} file(s) (budget: ${BUDGET} bytes)\n`,
    stderr: "",
  };
}

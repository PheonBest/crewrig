// format-typescript.ts — rewrite every tracked TypeScript source with Oxfmt (spec 0266 R13).
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/format-typescript.ts
// Replaces the `git ls-files | xargs oxfmt --write` pipe of the Taskfile: no POSIX utility is
// spawned. Built copies under .claude/, .gemini/, .github/ and .agents/ are left alone. It never
// calls Oxfmt with an empty list (Oxfmt would then format the whole repository). Exit: 0 formatted
// or nothing to format, otherwise the status of Oxfmt.

import { spawnSync } from "node:child_process";
import path from "node:path";

const repoDir = path.resolve(import.meta.dirname, "..");
const BUILT_PREFIXES = [".claude/", ".gemini/", ".github/", ".agents/"];
const CHUNK = 100;

const listed = spawnSync("git", ["ls-files", "-z", "*.ts"], { cwd: repoDir, encoding: "utf8" });
if (listed.status !== 0) {
  process.stderr.write(listed.stderr);
  process.exitCode = listed.status ?? 1;
} else {
  const files = listed.stdout
    .split("\0")
    .filter((f) => f !== "" && !BUILT_PREFIXES.some((p) => f.startsWith(p)));
  const bin = path.join(repoDir, "node_modules", ".bin", "oxfmt");
  for (let i = 0; i < files.length && process.exitCode === undefined; i += CHUNK) {
    const run = spawnSync(bin, ["--write", ...files.slice(i, i + CHUNK)], {
      cwd: repoDir,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    if (run.status !== 0) process.exitCode = run.status ?? 1;
  }
}

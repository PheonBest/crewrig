// test-strays.ts — logic of check-test-strays (twin of check-test-strays.sh, spec 0259).
//
// Static syntax guard: `bash -n` over every scripts/tests/test-*.sh, in UTF-16
// order, stopping at the first failure. Executes no suite.
//
// Usage: runTestStrays(argv, { repoDir, platform })
// Exit codes: 0 clean (or skipped on win32), 1 syntax error, 2 usage or setup error.
// Finding-line format: `FAILED: <name> has syntax errors:` then Bash's text, on stderr.

import { spawnSync } from "node:child_process";
import fs from "node:fs";

export interface StraysOutcome {
  stdout: string;
  stderr: string;
  code: number;
}

export interface StraysOptions {
  repoDir: string;
  /** Injectable for tests; defaults to process.platform. */
  platform?: NodeJS.Platform;
}

const IGNORED_WITH_VALUE = new Set(["--cache-dir", "--base-ref", "--jobs"]);

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Run the check; pure apart from reading the tests directory and spawning bash. */
export function runTestStrays(argv: readonly string[], opts: StraysOptions): StraysOutcome {
  const testsDir = `${opts.repoDir}/scripts/tests`;
  for (let i = 0; i < argv.length;) {
    const arg = argv[i] as string;
    if (IGNORED_WITH_VALUE.has(arg)) {
      if (argv.length - i < 2) {
        return { stdout: "", stderr: `Error: option '${arg}' requires a value\n`, code: 2 };
      }
      i += 2;
    } else {
      return {
        stdout: "",
        stderr: `Error: unknown option or argument '${arg}'\n`,
        code: 2,
      };
    }
  }

  let isDir = false;
  try {
    isDir = fs.statSync(testsDir).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) {
    return { stdout: "", stderr: `Error: tests directory not found: ${testsDir}\n`, code: 2 };
  }

  if ((opts.platform ?? process.platform) === "win32") {
    return {
      stdout:
        "SKIP: the Bash suites run on Linux only; the static syntax check is skipped on win32 (transitional until row J4).\n",
      stderr: "",
      code: 0,
    };
  }

  const names = fs
    .readdirSync(testsDir)
    .filter((n) => n.startsWith("test-") && n.endsWith(".sh"))
    .sort();
  let count = 0;
  for (const name of names) {
    const suite = `${testsDir}/${name}`;
    if (!isFile(suite)) continue;
    count += 1;
    const res = spawnSync("bash", ["-n", suite], { encoding: "utf8", shell: false });
    if (res.error !== undefined) {
      return { stdout: "", stderr: `Error: cannot run bash: ${res.error.message}\n`, code: 2 };
    }
    if (res.status !== 0) {
      const errOut = `${res.stdout}${res.stderr}`.replace(/\n+$/, "");
      return {
        stdout: "",
        stderr: `FAILED: ${name} has syntax errors:\n${errOut}\n`,
        code: 1,
      };
    }
  }
  return {
    stdout: `OK: ${count} test suites pass the static syntax check; none executed.\n`,
    stderr: "",
    code: 0,
  };
}

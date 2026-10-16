// run.ts — e2e scenario runner entry (issue #78; spec 0261). TypeScript twin of tests/e2e/run.sh:
// `node tests/e2e/run.ts [--scenario <name>] [--cli <cli>] [--report-dir <path>] [--keep <N>]
// [--dry-run]`. The logic lives in lib/runner-*.ts.

import fs from "node:fs";

import { runRunner } from "./lib/runner-main.ts";

const env: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;

process.exitCode = runRunner({
  argv: process.argv.slice(2),
  env,
  e2eDir: import.meta.dirname,
  io: {
    out: (text) => void (text !== "" && fs.writeSync(1, text)),
    err: (text) => void (text !== "" && fs.writeSync(2, text)),
  },
});

// probe-antigravity-discovery.ts — TypeScript twin of scripts/probe-antigravity-discovery.sh
// (spec 0123 R13/R14, spec 0261). Usage: node scripts/probe-antigravity-discovery.ts

import { runProbe } from "./lib/probe-antigravity/run.ts";

const env: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;

runProbe({
  env,
  cwd: process.cwd(),
  out: (t) => void process.stdout.write(t),
  err: (t) => void process.stderr.write(t),
}).then((code) => {
  process.exitCode = code;
});

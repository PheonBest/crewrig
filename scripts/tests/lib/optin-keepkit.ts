// optin-keepkit.ts — helpers of the keep and rewrite suites of the usage-capture opt-in (spec 0263,
// row J1b): usage-capture-optin-keep.test.ts and usage-capture-optin-rewrite.test.ts. Built on
// optin-fixtures.ts and optin-oracle.ts; written for this slice only.
//
//   both(r): string                       stdout then stderr (the Bash suite read `2>&1`)
//   same(a, b): boolean                   two files hold the same bytes
//   run(s, sub, cli, cfg, repo, platform?): RunResult   one of keep | rewrite | state | disclose
//   stateOf(s, cli, cfg): string          the trimmed `state` answer
//   firstEvent(cli): string               the first R5 event of the CLI
//   writeJson(file, doc): void            pretty JSON, parent directory created
//   assertOnceAt(cli, cfg, script): void  exactly one capture per R5 event at `script`, none elsewhere
//   prefixCapture(file, prefix): void     put `prefix` in front of every string naming usage-capture.sh
//   usageCaptureStub(dir): string         a stub <dir>/hooks/usage-capture.sh, returns its path

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { runOptin, type RunResult, type Scratch } from "./optin-fixtures.ts";
import {
  captureCmds,
  captureCount,
  captureEvents,
  cliEvents,
  expectedCmd,
  isObj,
  readJson,
  sortedEvents,
  type Json,
  type OptinCli,
} from "./optin-oracle.ts";

export const both = (r: RunResult): string => r.stdout + r.stderr;
export const same = (a: string, b: string): boolean =>
  fs.readFileSync(a).equals(fs.readFileSync(b));

export function run(
  s: Scratch,
  sub: "keep" | "rewrite" | "state" | "disclose",
  cli: OptinCli,
  cfg: string,
  repo: string,
  platform?: string,
): RunResult {
  const args = sub === "state" ? [cli, cfg] : [cli, cfg, repo];
  return runOptin(sub, args, { env: s.env, ...(platform ? { platform } : {}) });
}
export const stateOf = (s: Scratch, cli: OptinCli, cfg: string): string =>
  run(s, "state", cli, cfg, "").stdout.trim();

export const firstEvent = (cli: OptinCli): string => cliEvents(cli)[0] ?? "";

export function writeJson(file: string, doc: Json): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
}

export function assertOnceAt(cli: OptinCli, cfgFile: string, script: string): void {
  const cfg = readJson(cfgFile);
  for (const ev of cliEvents(cli)) {
    assert.equal(captureCount(cfg, ev), 1, `${cli} ${ev}: one capture handler`);
    assert.deepEqual(captureCmds(cfg, ev), [expectedCmd(cli, ev, script)], `${cli} ${ev}`);
  }
  assert.equal(captureEvents(cfg), sortedEvents(cli), `${cli}: capture on no event outside R5`);
}

function prefixed(v: Json, prefix: string): Json {
  if (typeof v === "string") return v.includes("usage-capture.sh") ? prefix + v : v;
  if (Array.isArray(v)) return v.map((x) => prefixed(x, prefix));
  if (isObj(v))
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, prefixed(x, prefix)]));
  return v;
}
export function prefixCapture(file: string, prefix: string): void {
  writeJson(file, prefixed(readJson(file), prefix));
}

export function usageCaptureStub(dir: string): string {
  const stub = path.join(dir, "hooks", "usage-capture.sh");
  fs.mkdirSync(path.dirname(stub), { recursive: true });
  fs.writeFileSync(stub, "#!/bin/bash\nexit 0\n");
  return stub;
}

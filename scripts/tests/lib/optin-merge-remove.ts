// optin-merge-remove.ts — small helpers shared by usage-capture-optin-merge.test.ts and
// usage-capture-optin-remove.test.ts (spec 0263, row J1b): the "exactly one capture command per R5
// event at a path" assertion of the Bash `assert_capture_once_at`, and a raw-command registrar.

import assert from "node:assert/strict";

import { runOptin } from "./optin-fixtures.ts";
import {
  captureCmds,
  captureCount,
  captureEvents,
  cliEvents,
  expectedCmd,
  legacyCmd,
  sortedEvents,
  type Json,
  type OptinCli,
} from "./optin-oracle.ts";

export function assertCaptureOnceAt(
  cfg: Json,
  cli: OptinCli,
  script: string,
  form: "quoted" | "legacy" = "quoted",
): void {
  for (const ev of cliEvents(cli)) {
    const want = (form === "legacy" ? legacyCmd : expectedCmd)(cli, ev, script);
    assert.equal(captureCount(cfg, ev), 1, `${cli} ${ev}: exactly one capture handler`);
    assert.deepEqual(captureCmds(cfg, ev), [want], `${cli} ${ev}: command`);
  }
  assert.equal(captureEvents(cfg), sortedEvents(cli), `${cli}: no capture outside the R5 events`);
}

/** Register raw commands on one event: one new group (grouped CLIs) or flat handlers (copilot). */
export function addRaw(cfg: Json, cli: OptinCli, ev: string, ...cmds: string[]): void {
  const hooks = (cfg as { hooks: { [k: string]: Json[] } }).hooks;
  const hs: Json[] = cmds.map((command) => ({ type: "command", command }));
  hooks[ev] = [...(hooks[ev] ?? []), ...(cli === "copilot" ? hs : [{ hooks: hs }])];
}

/** The capture state, footprint length and registered paths as the entry reports them. */
export function detect(
  env: NodeJS.ProcessEnv,
  cli: OptinCli,
  cfg: string,
): { state: string; footprint: number; paths: string } {
  const out = (sub: string): string => runOptin(sub, [cli, cfg], { env }).stdout;
  const fp: unknown = JSON.parse(out("footprint") || "null");
  return {
    state: out("state").trim(),
    footprint: Array.isArray(fp) ? fp.length : -1,
    paths: out("paths").trim(),
  };
}

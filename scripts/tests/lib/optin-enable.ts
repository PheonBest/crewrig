// optin-enable.ts — assertions and process helpers shared by usage-capture-optin-enable*.test.ts
// (spec 0263, row J1b). Built on optin-oracle.ts and optin-fixtures.ts; nothing here reads the
// implementation of the capture predicate.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { REPO, type Scratch } from "./optin-fixtures.ts";
import {
  captureCmds,
  captureCount,
  captureEvents,
  cliEvents,
  expectedCmd,
  legacyCmd,
  readJson,
  sortedEvents,
  type OptinCli,
} from "./optin-oracle.ts";

export const SKIP_POSIX =
  "registered command is run through a POSIX shell; Windows wiring is covered by usage-capture-windows.test.ts and setup-usage-capture-wire-path.test.ts";
export const SESSION = path.join(
  REPO,
  "scripts/tests/fixtures/usage-capture/claude-code/2.1.x-jsonl/session.jsonl",
);

/** Exactly one capture command per R5 event at `script`, and capture on no other event. */
export function assertOnceAt(
  cfg: string,
  cli: OptinCli,
  script: string,
  form: "quoted" | "legacy" = "quoted",
): void {
  const doc = readJson(cfg);
  for (const ev of cliEvents(cli)) {
    const want = (form === "legacy" ? legacyCmd : expectedCmd)(cli, ev, script);
    assert.equal(captureCount(doc, ev), 1, `${cli} ${ev}: one capture handler`);
    assert.deepEqual(captureCmds(doc, ev), [want]);
  }
  assert.equal(captureEvents(doc), sortedEvents(cli));
}

/** Run a registered command with `/bin/sh -c` from outside the repo on a PATH holding only node. */
export function runRegistered(
  s: Scratch,
  cmd: string,
  cli: OptinCli,
  label: string,
): { status: number | null; journal: string[]; premiseOk: boolean } {
  const bin = path.join(s.tmp, `bin-${label}`);
  const elsewhere = path.join(s.tmp, `elsewhere-${label}`);
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(elsewhere, { recursive: true });
  fs.symlinkSync(process.execPath, path.join(bin, "node"));
  const PATH = `${bin}:/usr/bin:/bin`;
  const probe = spawnSync("/bin/sh", ["-c", "command -v mempalace"], { env: { PATH } });
  const session = path.join(s.tmp, `session-${label}.jsonl`);
  fs.copyFileSync(SESSION, session);
  const root = path.join(s.tmp, `usage-${label}-${cli}`);
  const r = spawnSync("/bin/sh", ["-c", cmd], {
    cwd: elsewhere,
    env: { ...s.env, PATH, CREWRIG_USAGE_ROOT: root },
    input: cli === "claude" ? JSON.stringify({ transcript_path: session }) : "{}",
    encoding: "utf8",
  });
  const dir = path.join(root, "journal");
  const journal = fs.existsSync(dir)
    ? fs
        .readdirSync(dir, { recursive: true, encoding: "utf8" })
        .filter(
          (f) => f.endsWith(".json") && !f.endsWith(".wing.json") && !f.endsWith(".attr.json"),
        )
    : [];
  return { status: r.status, journal, premiseOk: probe.status !== 0 };
}

// usage-entry-rig.ts — the runner of setup-lib-usage-entry.test.ts: the entry scripts/usage-capture-optin.ts
// run in a throwaway HOME over one configuration (the Bash oracle went with the library, spec 0266).

import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { mode, rig, stamp } from "./usage-capture-rig.ts";
import { cleanEnv, realTmp, REPO } from "./worktree-fixtures.ts";

export const ENTRY = path.join(REPO, "scripts", "usage-capture-optin.ts");

export function node(args: readonly string[], env: NodeJS.ProcessEnv = cleanEnv()) {
  const home = realTmp("uc-entry-home-");
  const res = spawnSync(process.execPath, [ENTRY, ...args], {
    encoding: "utf8",
    cwd: home,
    env: { ...env, HOME: home, USERPROFILE: home },
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, home };
}

/** What the entry produces, with paths and backup stamps normalised. */
export interface Leg {
  readonly rc: number | null;
  readonly out: string;
  readonly err: string;
  readonly file: string | null;
  readonly mode: number | null;
  readonly result: string | null;
}

/** One case: the entry's `args` over a fresh configuration. */
export function same(
  initial: unknown,
  args: (f: { cfg: string; co: string; out: string; res: string }) => string[],
): Leg {
  const r = rig(initial);
  const dir = realTmp("uc-legs-");
  const t = {
    cfg: r.cfgT,
    co: r.co,
    out: path.join(dir, "t-out.json"),
    res: path.join(dir, "t-res.txt"),
  };
  const ts = node(args(t));
  const norm = (text: string): string =>
    stamp(text.split(t.cfg).join("<F>").split(t.out).join("<O>")).trimEnd();
  const read = (p: string): string | null => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null);
  assert.notEqual(ts.status, null, "the entry was terminated by a signal");
  assert.doesNotMatch(ts.stderr, /^\s+at .*:\d+:\d+\)?$/m, "the entry crashed with a stack trace");
  return {
    rc: ts.status,
    out: norm(ts.stdout),
    err: norm(ts.stderr),
    file: read(t.cfg),
    mode: fs.existsSync(t.cfg) ? mode(t.cfg) : null,
    result: read(t.res),
  };
}

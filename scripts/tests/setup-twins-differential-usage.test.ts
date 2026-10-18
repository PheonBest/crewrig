// setup-twins-differential-usage.test.ts — spec 0256 requirement 10 (last clause), the usage-capture twins.
// The shell-versus-twin comparison against the retired scripts/lib/usage-capture-optin.sh is gone with the
// library (spec 0266); the node-floor function keeps its outcomes as literal values. The other usage-capture
// twins are covered by setup-usage-capture.test.ts, setup-usage-capture-keep.test.ts and
// setup-lib-usage-entry.test.ts. Linux only.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { usageCaptureRequireNodeFloor } from "../lib/setup/usage-capture-fragment.ts";
import { REPO } from "./lib/worktree-fixtures.ts";

const LINUX = process.platform === "linux";
const HAS_BASH = spawnSync("bash", ["--version"]).status === 0;
const SKIP = !LINUX || !HAS_BASH ? "SKIP: Linux with bash only" : false;

const roots: string[] = [];
after(() => roots.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
const tmp = (): string => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "twins-uc-")));
  roots.push(dir);
  return dir;
};

interface Leg {
  readonly ok: boolean;
  readonly err: string;
}

/** The twin, with `PATH` as given and, optionally, a floor guard other than the checkout's. */
function twin(pathEnv: string, floorGuard?: string): Leg {
  const err: string[] = [];
  const io = {
    out: () => undefined,
    err: (l: string) => void err.push(l),
    errRaw: (t: string) => void err.push(t.replace(/\n$/, "")),
  };
  const home = tmp();
  const ctx = { io, env: { PATH: pathEnv }, platform: process.platform, home, repoDir: REPO };
  const ok = usageCaptureRequireNodeFloor(ctx, floorGuard === undefined ? {} : { floorGuard });
  return { ok, err: err.join("\n") };
}

/** A directory with a stub `node` running `body`, found first on PATH. */
function stubNode(body: string): string {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "node"), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return dir;
}

describe("usageCaptureRequireNodeFloor", { skip: SKIP }, () => {
  test("the floor met: true, silent, with the real node and the real guard", () => {
    assert.deepEqual(twin(path.dirname(process.execPath)), { ok: true, err: "" });
  });

  test("no node on PATH: false and the diagnostic line", () => {
    const got = twin(tmp());
    assert.equal(got.ok, false);
    assert.match(
      got.err,
      /^ {2}ERROR: crewrig: Node\.js was not found on PATH; usage capture requires Node\.js >= 24\./,
    );
  });

  test("below the floor: the guard diagnostic, verbatim", () => {
    const dir = stubNode('echo "crewrig: requires Node.js >= 24 (stub)" >&2; exit 1');
    assert.deepEqual(twin(dir), { ok: false, err: "crewrig: requires Node.js >= 24 (stub)" });
  });

  test("the guard missing from the checkout: the line, with and without node", () => {
    const guard = path.join(tmp(), "scripts", "lib", "node-floor-guard.js");
    for (const pathEnv of [path.dirname(process.execPath), tmp()]) {
      const got = twin(pathEnv, guard);
      assert.equal(got.ok, false, pathEnv);
      assert.match(got.err, /Node\.js floor guard not found at /);
    }
  });
});

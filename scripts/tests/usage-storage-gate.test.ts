// usage-storage-gate.test.ts — groups (g1), (g2), (h) and MUT-2 of test-usage-storage.sh
// (spec 0260): the no-MemPalace gate, the unreachable-stamp backoff, the token path and
// the mutation that neutralises the gate. Every test builds its own sandbox (the Bash
// suite left a token file behind from (g1) for (g2) and (m)): the temp HOME holds the
// token, so nothing is ever written under the real home.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test, describe, after } from "node:test";

import { requireOrSkip } from "./lib/capability.ts";
import { applyMutation, copyTracked } from "./lib/mutation-copy.ts";
import {
  backdate,
  countFiles,
  drive,
  makeRecord,
  periodOf,
  pendingMarker,
  sandbox,
  writeRecord,
  type Sandbox,
} from "./lib/usage-storage-rig.ts";
import { mutated } from "./lib/usage-mutants.ts";
import { makePathDir, REPO, SKIP_POSIX, which } from "./lib/worktree-fixtures.ts";

const boxes: Sandbox[] = [];
const fresh = (repo?: string): Sandbox => {
  const sb = sandbox(repo);
  boxes.push(sb);
  return sb;
};
after(() => {
  for (const sb of boxes) sb.cleanup();
});

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function waitFor(file: string, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fs.existsSync(file)) return true;
    await sleep(100);
  }
  return fs.existsSync(file);
}

/** A `bash` on PATH that only records a usage-mirror.sh spawn (never runs a real mirror). */
function stubBash(sb: Sandbox): { sentinel: string; env: Record<string, string> } {
  const sentinel = path.join(sb.home, "mirror-spawned.sentinel");
  const dir = makePathDir({
    scripts: {
      bash: `case "$*" in\n  *usage-mirror.sh*) touch "${sentinel}" ;;\n  *) exec /bin/bash "$@" ;;\nesac`,
    },
  });
  return { sentinel, env: { PATH: `${dir}${path.delimiter}${process.env.PATH ?? ""}` } };
}

function placeToken(sb: Sandbox): string {
  const token = drive(sb, ["token-path"]).stdout.trim();
  fs.mkdirSync(path.dirname(token), { recursive: true });
  fs.writeFileSync(token, "test-token-value\n");
  return token;
}

describe("(g1) no-MemPalace gate", { skip: SKIP_POSIX }, () => {
  test("no token: no mirror dir, no spawn", async () => {
    const sb = fresh();
    const stub = stubBash(sb);
    const rec = makeRecord({ session: "gate-session-1", idem: "gate-key-1" });
    const out = writeRecord(sb, rec, { ...stub.env, CREWRIG_USAGE_MIRROR: "" });
    assert.equal(out.state, "stored", out.stdout);
    assert.equal(fs.existsSync(path.join(sb.root, "mirror")), false, "mirror/ was created");
    await sleep(500);
    assert.equal(fs.existsSync(stub.sentinel), false, "usage-mirror.sh was spawned without token");
  });

  test("token present: 1 pending marker, 0 mirrored (MIRROR=0 blocks the spawn)", () => {
    const sb = fresh();
    placeToken(sb);
    const rec = makeRecord({ session: "gate-session-2", idem: "gate-key-2" });
    assert.equal(writeRecord(sb, rec).state, "stored");
    assert.ok(
      fs.existsSync(pendingMarker(sb, "claude-code", periodOf(rec), rec.recordId)),
      "no pending marker despite a token file",
    );
    assert.equal(countFiles(path.join(sb.root, "mirror", "pending")), 1);
    assert.equal(countFiles(path.join(sb.root, "mirror", "mirrored")), 0);
  });
});

describe("(h) token path", () => {
  // The Bash cases compared tokenPath() with `bash -c '. scripts/lib/common.sh; mcp_token_path'`.
  // common.sh is a sourced library retired by row J4: these two tests spawn bash to source it
  // (a migration, not a retirement) and J4 deletes them with the library; the same property is
  // also asserted at consumer level by service-launcher-token.test.ts.
  const bashTokenPath = (sb: ReturnType<typeof fresh>, palace: string): string => {
    const r = spawnSync("bash", ["-c", `. '${REPO}/scripts/lib/common.sh'; mcp_token_path`], {
      encoding: "utf8",
      env: { ...sb.env({ MEMPALACE_PALACE_PATH: palace }), PATH: process.env.PATH },
    });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  for (const [name, exists] of [
    ["existing MEMPALACE_PALACE_PATH", true],
    ["not-yet-existing MEMPALACE_PALACE_PATH", false],
  ] as const) {
    test(`tokenPath() matches mcp_token_path (${name})`, (t) => {
      if (!requireOrSkip(t, which("bash") !== null, "needs bash", { posixOnly: true })) return;
      const sb = fresh();
      const palace = exists ? sb.palace : path.join(path.dirname(sb.palace), "does-not-exist-yet");
      const node = drive(sb, ["token-path"], { MEMPALACE_PALACE_PATH: palace }).stdout.trim();
      assert.equal(bashTokenPath(sb, palace), node);
    });
  }

  test("tokenPath() is HOME/.mempalace/server/<24 hex>/token, stable before and after the palace exists", () => {
    const sb = fresh();
    const parent = path.dirname(sb.palace);
    const gone = path.join(parent, "does-not-exist-yet");
    const before = drive(sb, ["token-path"], { MEMPALACE_PALACE_PATH: gone }).stdout.trim();
    fs.mkdirSync(gone);
    const after = drive(sb, ["token-path"], { MEMPALACE_PALACE_PATH: gone }).stdout.trim();
    assert.equal(before, after);
    const rel = path.relative(sb.home, before).split(path.sep);
    assert.deepEqual([rel[0], rel[1]], [".mempalace", "server"]);
    assert.match(rel[2] ?? "", /^[0-9a-f]{24}$/);
    assert.equal(rel[3], "token");
  });
});

describe("(g2) backoff: unreachable.stamp", { skip: SKIP_POSIX }, () => {
  test("a fresh unreachable.stamp suppresses the spawn", async () => {
    const sb = fresh();
    placeToken(sb);
    const stub = stubBash(sb);
    fs.mkdirSync(path.join(sb.root, "mirror"), { recursive: true });
    fs.writeFileSync(path.join(sb.root, "mirror", "unreachable.stamp"), "");
    const rec = makeRecord({ session: "backoff-session-1", idem: "backoff-key-1" });
    assert.equal(writeRecord(sb, rec, { ...stub.env, CREWRIG_USAGE_MIRROR: "1" }).state, "stored");
    assert.equal(
      await waitFor(stub.sentinel, 500),
      false,
      "fresh stamp did NOT suppress the spawn",
    );
  });

  test("a stale (15 min) unreachable.stamp allows the spawn", async () => {
    const sb = fresh();
    placeToken(sb);
    const stub = stubBash(sb);
    const stamp = path.join(sb.root, "mirror", "unreachable.stamp");
    fs.mkdirSync(path.dirname(stamp), { recursive: true });
    fs.writeFileSync(stamp, "");
    backdate(stamp, 900_000);
    const rec = makeRecord({ session: "backoff-session-2", idem: "backoff-key-2" });
    assert.equal(writeRecord(sb, rec, { ...stub.env, CREWRIG_USAGE_MIRROR: "1" }).state, "stored");
    assert.equal(
      await waitFor(stub.sentinel, 3000),
      true,
      "stale stamp still suppressed the spawn",
    );
  });
});

describe("MUT-2 the gate ignoring the token check", () => {
  const MARKER = "if (!fs.existsSync(mcp.tokenPath())) {\n    return;\n  }";
  const MIRROR = "scripts/lib/usage-store/mirror.js";
  test("MUTATION RED: gate neutralised -> pending marker without any token", () => {
    const copy = mutated(MIRROR, MARKER, "if (false) {\n    return;\n  }");
    try {
      const sb = fresh(copy.root);
      const rec = makeRecord({ session: "mutant-gate-session", idem: "mutant-gate-key" });
      assert.equal(writeRecord(sb, rec).state, "stored");
      assert.ok(
        fs.existsSync(pendingMarker(sb, "claude-code", periodOf(rec), rec.recordId)),
        "no pending marker even with the gate neutralised",
      );
    } finally {
      copy.dispose();
    }
  });

  test("green twin: unmutated tree creates no pending marker without a token", () => {
    const sb = fresh();
    const rec = makeRecord({ session: "mutant-gate-session", idem: "mutant-gate-key" });
    assert.equal(writeRecord(sb, rec).state, "stored");
    assert.equal(countFiles(path.join(sb.root, "mirror")), 0);
  });

  test("a missing marker makes the mutation helper throw", () => {
    const copy = copyTracked(path.resolve(import.meta.dirname, "..", ".."), [MIRROR]);
    try {
      assert.throws(() => applyMutation(copy, MIRROR, "no such gate text", "x"), /needle absent/);
    } finally {
      copy.dispose();
    }
  });
});

// usage-attribution-channels.test.ts — R25 of test-usage-attribution.sh (spec 0208 R25, spec 0260
// groups R25-1..R25-13): the four declaration channels, precedence, and the branch-shape cases.
// One usage root is shared by the whole file, as in the Bash suite (declarations accumulate).
// Synthetic checkouts are hand-written `.git/HEAD` + `config`; no git binary is needed.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { cleanupAll, WINDOWS } from "./lib/worktree-fixtures.ts";
import {
  buildCheckout,
  type Case,
  driver,
  fixture,
  libScript,
  newCase,
  realTmp,
} from "./lib/usage-attribution-rig.ts";

const GITHUB = "git@github.com:crewrig/crewrig.git";
let c: Case;
let syn = "";
let noGit = "";

const decl = (key: string, channel: string, session: string) =>
  driver(c, [
    "declaration-write",
    JSON.stringify({ taskHandoffKey: key, declaringChannel: channel, sessionId: session }),
  ]);

function resolve(rec: string, cwd: string, extra: Record<string, string | undefined> = {}) {
  const out = driver(c, ["resolve", fixture(rec)], { ATTR_CTX_CWD: cwd, ...extra });
  assert.equal(out.status, 0, out.stderr);
  return out.stdout;
}

function checkout(name: string, branch: string, remote?: string): string {
  const dir = path.join(syn, name);
  buildCheckout(dir, branch, remote);
  return dir;
}

function spec(dir: string, file: string, related: number, id: string, slug: string) {
  fs.mkdirSync(path.join(dir, "specs"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "specs", file),
    `---\nid: "${id}"\nslug: ${slug}\nstatus: implemented\ncomplexity: standard\ninteraction-mode: INTERMEDIATE\nrelated-issue: ${related}\nversion: 1.0.0\n---\n\n# ${slug}\n`,
  );
}

describe("usage attribution channels (R25)", () => {
  before(() => {
    c = newCase();
    syn = realTmp("usage-attr-syn-");
    noGit = realTmp("usage-attr-nogit-");
  });
  after(() => cleanupAll());

  test("R25-1 ch1 explicit declaration", () => {
    decl("ch1-key", "explicit", "attr-ch1-session");
    const out = resolve("r25-ch1-explicit.json", noGit);
    assert.match(out, /"channel":"explicit"/);
    assert.match(out, /"taskHandoffKey":"ch1-key"/);
    assert.match(out, /"outcome":"attributed"/);
  });

  test("R25-2 ch2 env", () => {
    const out = resolve("r25-ch2-env.json", noGit, { ATTR_CTX_ENV_CREWRIG_TASK: "ch2-key" });
    assert.match(out, /"channel":"env"/);
    assert.match(out, /"taskHandoffKey":"ch2-key"/);
    assert.match(out, /"outcome":"attributed"/);
  });

  test("R25-3 ch3 worktree", () => {
    const dir = checkout("ch3-checkout", "fix/0777-attr-ch3-probe", GITHUB);
    const out = resolve("r25-ch3-worktree.json", dir);
    assert.match(out, /"channel":"worktree"/);
    assert.match(out, /"taskHandoffKey":"777"/);
    assert.match(out, /"outcome":"attributed"/);
  });

  test("R25-4 ch4 protocol", () => {
    decl("ch4-key", "protocol", "attr-ch4-session");
    const out = resolve("r25-ch4-protocol.json", noGit);
    assert.match(out, /"channel":"protocol"/);
    assert.match(out, /"taskHandoffKey":"ch4-key"/);
    assert.match(out, /"outcome":"attributed"/);
  });

  test("R25-5 malformed ch1 does not fall through", () => {
    decl("has a space", "explicit", "attr-malformed-session");
    const out = resolve("r25-malformed-ch1.json", noGit, {
      ATTR_CTX_ENV_CREWRIG_TASK: "valid-env-key",
    });
    assert.match(out, /"outcome":"unattributed"/);
    assert.match(out, /"channel":"explicit"/);
    assert.match(out, /invalid taskHandoffKey/i);
    assert.ok(!out.includes("valid-env-key"), `env key leaked: ${out}`);
  });

  test("R25-6 (i) spec file maps to related issue", () => {
    const dir = checkout("branch-i", "spec/0208-usage-attribution");
    spec(dir, "0208-usage-attribution.md", 1171, "0208", "usage-attribution");
    const out = resolve("r25-branch-i.json", dir);
    assert.match(out, /"taskHandoffKey":"1171"/);
    assert.match(out, /"channel":"worktree"/);
    assert.ok(!out.includes('"taskHandoffKey":"208"'));
  });

  test("R25-7 (ii) no spec file falls to ch4", () => {
    const dir = checkout("branch-ii", "spec/0208-usage-attribution");
    decl("branch-ii-key", "protocol", "attr-branch-ii-session");
    const out = resolve("r25-branch-ii.json", dir);
    assert.match(out, /"channel":"protocol"/);
    assert.match(out, /"taskHandoffKey":"branch-ii-key"/);
  });

  test("R25-8 (iii) subdir walks up: declaration, then forge asset", () => {
    const dir = checkout("branch-iii", "fix/0900-subdir-case", GITHUB);
    const sub = path.join(dir, "a", "b");
    fs.mkdirSync(sub, { recursive: true });
    const set = libScript(
      c,
      "scripts/lib/usage-store/declaration.js",
      ["set", "--channel", "explicit", "--task-key", "subdir-decl-key"],
      dir,
    );
    assert.equal(set.status, 0, set.stderr);
    const ctx = { ATTR_PROJECT_ROOT_OVERRIDE: sub };
    let out = resolve("r25-branch-iii.json", sub, ctx);
    assert.match(out, /"channel":"explicit"/);
    assert.match(out, /"taskHandoffKey":"subdir-decl-key"/);
    const clear = libScript(c, "scripts/lib/usage-store/declaration.js", ["clear"], dir);
    assert.equal(clear.status, 0, clear.stderr);
    out = resolve("r25-branch-iii.json", sub, ctx);
    assert.match(out, /"channel":"worktree"/);
    assert.match(out, /"taskHandoffKey":"900"/);
    assert.match(out, /"kind":"forge-issue"/);
    assert.ok(out.includes("crewrig/crewrig#900"), out);
  });

  test("R25-9 (iv) pinned residue 203 after the spec file is gone", () => {
    const dir = checkout("branch-iv", "feat/0203-probe-c-guidance-surface");
    spec(dir, "0203-probe-c-guidance-surface.md", 1113, "0203", "probe-c-guidance-surface");
    assert.match(resolve("r25-branch-iv.json", dir), /"taskHandoffKey":"1113"/);
    fs.rmSync(path.join(dir, "specs", "0203-probe-c-guidance-surface.md"));
    assert.match(resolve("r25-branch-iv.json", dir), /"taskHandoffKey":"203"/);
  });

  test("R25-10 (v) no spec file: 54", () => {
    const dir = checkout("branch-v", "fix/0054-delta01-md029");
    assert.match(resolve("r25-branch-v.json", dir), /"taskHandoffKey":"54"/);
  });

  test(
    "R25-11 (vi) cwd worktree segment wins",
    { skip: WINDOWS ? "SKIP: .worktrees segment parsing is exercised on POSIX paths" : false },
    () => {
      const dir = path.join(syn, ".worktrees", "866");
      buildCheckout(dir, "feat/9999-unrelated-branch-name");
      assert.match(resolve("r25-branch-vi.json", dir), /"taskHandoffKey":"866"/);
    },
  );

  test("R25-12 (vii) forge-issue from ssh remote", () => {
    const dir = checkout("branch-vii", "fix/0866-reclassify-harness-transcript-traffic", GITHUB);
    const out = resolve("r25-branch-vii.json", dir);
    assert.match(out, /"taskHandoffKey":"866"/);
    assert.match(out, /"kind":"forge-issue"/);
    assert.ok(out.includes("crewrig/crewrig#866"), out);
  });

  test("R25-13 (viii) unrecognized host", () => {
    const dir = checkout(
      "branch-viii",
      "fix/0900-unrecognized-host-probe",
      "git@git.example.internal:org/repo.git",
    );
    const out = resolve("r25-branch-viii.json", dir, { ATTR_CTX_ENV_FORGE_HOSTS: "" });
    assert.match(out, /"taskHandoffKey":"900"/);
    assert.ok(!out.includes("externalAsset"), out);
    assert.match(out, /no recognized forge host/i);
  });
});

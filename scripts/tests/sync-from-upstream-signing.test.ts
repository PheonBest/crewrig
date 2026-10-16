// sync-from-upstream-signing.test.ts — signed graft commits of `--preserve-history`
// (spec 0260; replaces group G8 (cc..jj) and the pp capability self-test of
// test-sync-from-upstream.sh). Signing keys live OUTSIDE the adopter worktree: inside it the
// R8 anti-pollution guard would reject the untracked key before any signing happens.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test, type TestContext } from "node:test";
import { requireOrSkip } from "./lib/capability.ts";
import {
  cloneFull,
  commitFiles,
  commitIsSigned,
  createSyncRoot,
  git,
  headOf,
  makeAdopter,
  makeUpstream,
  read,
  runSync,
  sshSigningCapable,
  tomlPath,
  why,
  type SyncRoot,
} from "./lib/sync-fixture.ts";

const WIN = process.platform === "win32" ? "POSIX-only: ssh signing and sh stubs" : false;
const PRESERVE = { args: ["--preserve-history"] };
const V1 = { "core-file.txt": "upstream v1 content", "other.txt": "other content" };
const V2 = { "core-file.txt": "upstream v2 content" };

let sr: SyncRoot;
before(() => {
  sr = createSyncRoot("crewrig-sync-gs-");
});
after(() => sr.dispose());

/** Upstream at v1 then v2, and an adopter at v1 with config and manifest committed. */
function fixture(...initArgs: string[]): { upstream: string; adopter: string } {
  const upstream = makeUpstream(sr, [V1, V2], ...initArgs);
  const adopter = makeAdopter(sr, {
    upstream,
    manifest: ["core-file.txt"],
    files: V1,
    initArgs,
  });
  return { upstream, adopter };
}

/** Signing config applied AFTER the fixture's own commits (they stay hermetic). */
function configureSigning(adopter: string, key: string, program?: string): void {
  git(sr, adopter, "config", "gpg.format", "ssh");
  git(sr, adopter, "config", "user.signingkey", key);
  if (program !== undefined) git(sr, adopter, "config", "gpg.ssh.program", program);
  git(sr, adopter, "config", "commit.gpgsign", "true");
}

/** A key directory outside any worktree, or undefined when `t` was skipped. */
function signerDir(t: TestContext): string | undefined {
  const keydir = sr.fresh("keys");
  return requireOrSkip(t, sshSigningCapable(keydir), "ssh-keygen -Y sign unavailable", {
    posixOnly: true,
  })
    ? keydir
    : undefined;
}

const parentCount = (adopter: string): number =>
  (git(sr, adopter, "cat-file", "commit", "HEAD").split("\n\n")[0] ?? "")
    .split("\n")
    .filter((l) => l.startsWith("parent ")).length;

describe("G8 signing (spec 0122, 0148)", { skip: WIN }, () => {
  // pp
  test("pp capability precheck: ssh-keygen -Y sign works", (t) => {
    const keydir = sr.fresh("keys");
    if (!requireOrSkip(t, sshSigningCapable(keydir), "ssh-keygen -Y sign unavailable")) return;
    assert.ok(fs.existsSync(path.join(keydir, "signer.pub")));
  });

  // cc
  test("cc signed graft: two parents (pre-tip, upstream sha), (signed)", (t) => {
    const keydir = signerDir(t);
    if (keydir === undefined) return;
    const { upstream, adopter } = fixture();
    const upstreamSha = headOf(sr, upstream);
    configureSigning(adopter, path.join(keydir, "signer.pub"));
    const tip = headOf(sr, adopter);
    const out = runSync(sr, adopter, PRESERVE);
    assert.equal(out.status, 0, why(out));
    assert.notEqual(headOf(sr, adopter), tip, "HEAD did not move");
    assert.ok(commitIsSigned(sr, adopter, "HEAD"), "graft commit carries no gpgsig header");
    assert.equal(parentCount(adopter), 2);
    assert.equal(git(sr, adopter, "rev-parse", "HEAD^1").trim(), tip);
    assert.equal(git(sr, adopter, "rev-parse", "HEAD^2").trim(), upstreamSha);
    git(sr, adopter, "merge-base", "--is-ancestor", upstreamSha, "HEAD");
    assert.ok(out.stdout.includes("(signed)"), why(out));
  });

  // dd
  test("dd gpgsign false: unsigned graft, no (signed), no signing noise on stderr", () => {
    const { adopter } = fixture();
    const tip = headOf(sr, adopter);
    const out = runSync(sr, adopter, PRESERVE);
    assert.equal(out.status, 0, why(out));
    assert.notEqual(headOf(sr, adopter), tip, "HEAD did not move");
    assert.ok(!commitIsSigned(sr, adopter, "HEAD"), "graft commit is signed");
    assert.ok(!out.stdout.includes("(signed)"), why(out));
    assert.doesNotMatch(out.stderr, /[Ss]ign/, why(out));
  });

  // ee
  test("ee missing signing key refuses; tip unmoved; restore already applied", () => {
    const { adopter } = fixture();
    configureSigning(adopter, path.join(sr.fresh("keys"), "absent-key.pub"));
    const tip = headOf(sr, adopter);
    const out = runSync(sr, adopter, PRESERVE);
    assert.notEqual(out.status, 0, why(out));
    assert.equal(headOf(sr, adopter), tip, "the tip moved");
    assert.equal(read(adopter, "core-file.txt"), "upstream v2 content");
    assert.ok(
      out.stderr.includes("refuses to commit — this repository is configured to sign"),
      why(out),
    );
  });

  // ff
  test("ff no-op probes nothing: exit 0, HEAD unchanged, `no-op` despite an absent key", () => {
    const upstream = makeUpstream(sr, [{ "core-file.txt": "upstream content" }]);
    const adopter = cloneFull(sr, upstream, "adopter-full");
    commitFiles(sr, adopter, "adopter config", {
      "crewrig.config.toml": `canonical_repo = "${tomlPath(upstream)}"\n`,
      ".crewrig/core-paths.txt": "core-file.txt\n",
    });
    configureSigning(adopter, path.join(sr.fresh("keys"), "absent-key.pub"));
    const tip = headOf(sr, adopter);
    const out = runSync(sr, adopter, PRESERVE);
    assert.equal(out.status, 0, why(out));
    assert.equal(headOf(sr, adopter), tip, "a commit was created");
    assert.ok(out.stdout.includes("no-op"), why(out));
  });

  // gg
  test("gg unreadable commit.gpgsign (yesplease) refuses; tip unmoved", () => {
    const { adopter } = fixture();
    git(sr, adopter, "config", "commit.gpgsign", "yesplease");
    const tip = headOf(sr, adopter);
    const out = runSync(sr, adopter, PRESERVE);
    assert.notEqual(out.status, 0, why(out));
    assert.equal(headOf(sr, adopter), tip, "the tip moved");
    assert.ok(out.stderr.includes("cannot determine whether to sign"), why(out));
  });

  // hh
  test("hh signing program writes an empty .sig: refuses with `built an unsigned commit`", (t) => {
    const keydir = signerDir(t);
    if (keydir === undefined) return;
    // git calls `<prog> -Y sign -n git -f <pubkey> <buffer>` and reads `<buffer>.sig`.
    const stub = path.join(keydir, "emptysig.sh");
    fs.writeFileSync(
      stub,
      '#!/bin/sh\nfor arg in "$@"; do buffer="$arg"; done\n: > "$buffer.sig"\nexit 0\n',
    );
    fs.chmodSync(stub, 0o755);
    const { adopter } = fixture();
    configureSigning(adopter, path.join(keydir, "signer.pub"), stub);
    const tip = headOf(sr, adopter);
    const out = runSync(sr, adopter, PRESERVE);
    assert.notEqual(out.status, 0, why(out));
    assert.equal(headOf(sr, adopter), tip, "the tip moved onto the unsigned commit");
    assert.ok(out.stderr.includes("built an unsigned commit"), why(out));
  });

  // ii
  test("ii gpgsign UNSET with an isolated HOME: unsigned graft, no (signed)", () => {
    const { adopter } = fixture();
    git(sr, adopter, "config", "--unset", "commit.gpgsign");
    const isolated = sr.fresh("isolated-home");
    fs.mkdirSync(isolated, { recursive: true });
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const k of ["CI", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM"]) delete env[k];
    Object.assign(env, {
      GIT_CONFIG_NOSYSTEM: "1",
      HOME: isolated,
      USERPROFILE: isolated,
      XDG_CONFIG_HOME: isolated,
    });
    const tip = headOf(sr, adopter);
    const out = runSync(sr, adopter, { ...PRESERVE, env });
    assert.equal(out.status, 0, why(out));
    assert.notEqual(headOf(sr, adopter), tip, "HEAD did not move");
    assert.ok(!commitIsSigned(sr, adopter, "HEAD"), "graft commit is signed");
    assert.ok(!out.stdout.includes("(signed)"), why(out));
  });

  // jj
  test("jj SHA-256 repositories: gpgsig-sha256 is recognised, (signed)", (t) => {
    const keydir = signerDir(t);
    if (keydir === undefined) return;
    const probe = spawnSync(
      "git",
      ["init", "-q", "--object-format=sha256", sr.fresh("sha-probe")],
      {
        env: sr.env,
      },
    );
    if (!requireOrSkip(t, probe.status === 0, "git without SHA-256 support (needs >= 2.29)"))
      return;
    const { adopter } = fixture("--object-format=sha256");
    assert.equal(git(sr, adopter, "rev-parse", "--show-object-format").trim(), "sha256");
    configureSigning(adopter, path.join(keydir, "signer.pub"));
    // Premise, independent of the sync: this fixture really produces the hash-dependent header.
    const tree = git(sr, adopter, "rev-parse", "HEAD^{tree}").trim();
    const header = git(sr, adopter, "commit-tree", tree, "-m", "sha256-header-probe", "-S");
    const probeHeader =
      git(sr, adopter, "cat-file", "commit", header.trim()).split("\n\n")[0] ?? "";
    assert.match(probeHeader, /^gpgsig-sha256 /m);
    const tip = headOf(sr, adopter);
    const out = runSync(sr, adopter, PRESERVE);
    assert.equal(out.status, 0, why(out));
    assert.notEqual(headOf(sr, adopter), tip, "HEAD did not move");
    assert.ok(commitIsSigned(sr, adopter, "HEAD"), "unsigned in a SHA-256 repository");
    assert.ok(out.stdout.includes("(signed)"), why(out));
  });
});

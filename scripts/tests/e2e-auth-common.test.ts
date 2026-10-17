// e2e-auth-common.test.ts — regression for scripts/e2e/lib/auth-common.ts (spec 0261 R19), the
// TypeScript migration of test-e2e-auth-common.sh. Locks the helper contract of ADR 0002: skip
// exits 78, e2e_e2e_home honours CREWRIG_E2E_HOME, e2e_cli_dir composes <home>/<cli>, the
// writability bootstrap is a host-side chmod, the bundle helpers set and correct 0700/0600.
// The shell's `bash -n`/sourceability/`declare -F` and "no `docker run` in the function body"
// reads are requirement-14/15 static reads of shell text and are not carried over.
// No Docker is needed. The POSIX mode cases are skipped on win32, which has no 0700/0600 modes.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  e2eAssertBundleModes,
  e2eChownBootstrap,
  e2eCliDir,
  e2eE2eHome,
  e2eEnsureBundleDir,
  e2eSkip,
  ExitError,
} from "../e2e/lib/auth-common.ts";

const POSIX = process.platform !== "win32";
const WIN_REASON = "POSIX file modes (0700/0600/a+rwx) do not exist on win32";
const tmps: string[] = [];
const mk = (): string => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-auth-common-"));
  tmps.push(d);
  return d;
};
const mode = (p: string): string => (fs.statSync(p).mode & 0o777).toString(8);

afterEach(() => {
  for (const d of tmps.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("auth-common", () => {
  it("e2e_skip exits with status 78", () => {
    assert.throws(
      () => e2eSkip("unit test"),
      (e: unknown) => e instanceof ExitError && e.status === 78,
    );
  });

  it("e2e_e2e_home honours CREWRIG_E2E_HOME", () => {
    const override = mk();
    assert.equal(e2eE2eHome({ CREWRIG_E2E_HOME: override }), `${override}/.crewrig-e2e`);
  });

  it("e2e_e2e_home defaults to $HOME/.crewrig-e2e", () => {
    assert.equal(e2eE2eHome({ HOME: "/tmp/fake-home" }), "/tmp/fake-home/.crewrig-e2e");
  });

  for (const cli of ["claude", "gemini", "copilot"]) {
    it(`e2e_cli_dir('${cli}') composes correctly`, () => {
      assert.equal(
        e2eCliDir({ CREWRIG_E2E_HOME: "/tmp/cr-test" }, cli),
        `/tmp/cr-test/.crewrig-e2e/${cli}`,
      );
    });
  }

  it(
    "e2e_chown_bootstrap runs on a real dir with host-side chmod and world-writable bits",
    {
      skip: POSIX ? false : WIN_REASON,
    },
    () => {
      const home = mk();
      const target = path.join(home, ".crewrig-e2e", "claude");
      fs.mkdirSync(target, { recursive: true });
      fs.chmodSync(target, 0o700);
      const r = e2eChownBootstrap({ CREWRIG_E2E_HOME: home }, "claude", "any-image");
      assert.equal(r.rc, 0);
      assert.equal(mode(target).slice(-1), "7");
    },
  );

  it(
    "e2e_ensure_bundle_dir creates the absent root and per-CLI dir at 0700, then is idempotent",
    {
      skip: POSIX ? false : WIN_REASON,
    },
    () => {
      const home = mk();
      const env = { CREWRIG_E2E_HOME: home };
      assert.equal(e2eEnsureBundleDir(env, "claude").rc, 0);
      assert.equal(mode(path.join(home, ".crewrig-e2e")), "700");
      assert.equal(mode(path.join(home, ".crewrig-e2e", "claude")), "700");
      assert.equal(e2eEnsureBundleDir(env, "claude").rc, 0);
    },
  );

  it(
    "e2e_assert_bundle_modes corrects a 0755/0644 fixture to 0700/0600",
    {
      skip: POSIX ? false : WIN_REASON,
    },
    () => {
      const home = mk();
      const bundle = path.join(home, ".crewrig-e2e", "claude");
      fs.mkdirSync(path.join(bundle, "sub"), { recursive: true });
      const files = [path.join(bundle, "a.json"), path.join(bundle, "sub", "b.json")];
      for (const f of files) {
        fs.writeFileSync(f, "");
        fs.chmodSync(f, 0o644);
      }
      for (const d of [bundle, path.join(bundle, "sub")]) fs.chmodSync(d, 0o755);
      assert.equal(e2eAssertBundleModes({ CREWRIG_E2E_HOME: home }, "claude").rc, 0);
      for (const d of [bundle, path.join(bundle, "sub")]) assert.equal(mode(d), "700");
      for (const f of files) assert.equal(mode(f), "600");
    },
  );
});

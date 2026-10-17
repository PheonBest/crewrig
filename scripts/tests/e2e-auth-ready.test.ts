// e2e-auth-ready.test.ts — regression for e2e_auth_ready() in scripts/e2e/lib/auth-common.ts
// (spec 0261 R19), the TypeScript migration of test-e2e-auth-ready.sh. The environment is a
// parameter of the twin, so no process state is touched; no Docker, no real account. Runs on
// every platform.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { e2eAuthReady, ExitError } from "../e2e/lib/auth-common.ts";

let home = "";
const bundle = (cli: string): string => path.join(home, ".crewrig-e2e", cli);
const ready = (cli: string, extra: Record<string, string> = {}) =>
  e2eAuthReady({ HOME: home, CREWRIG_E2E_HOME: home, ...extra }, cli);

before(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-auth-ready-"));
});
after(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

describe("e2e_auth_ready", () => {
  for (const cli of ["claude", "gemini", "copilot"]) {
    it(`clean env returns 78 for ${cli} and explains the gap`, () => {
      const r = ready(cli);
      assert.equal(r.rc, 78);
      assert.notEqual(r.stderr, "");
    });
  }

  it("ANTHROPIC_API_KEY set returns 0 for claude", () => {
    assert.equal(ready("claude", { ANTHROPIC_API_KEY: "test" }).rc, 0);
  });

  it("GEMINI_API_KEY set returns 0 for gemini", () => {
    assert.equal(ready("gemini", { GEMINI_API_KEY: "test" }).rc, 0);
  });

  it("COPILOT_GITHUB_TOKEN wins over GH_TOKEN and the message names only it", () => {
    const r = ready("copilot", { COPILOT_GITHUB_TOKEN: "primary", GH_TOKEN: "fallback" });
    assert.equal(r.rc, 0);
    assert.match(r.stderr, /COPILOT_GITHUB_TOKEN/);
    assert.doesNotMatch(r.stderr, /GH_TOKEN set/);
    assert.ok(!/(^|[^_A-Z])GH_TOKEN/.test(r.stderr));
  });

  it("GH_TOKEN alone returns 0 for copilot (fallback)", () => {
    assert.equal(ready("copilot", { GH_TOKEN: "fallback" }).rc, 0);
  });

  it("on-disk .credentials.json returns 0 for claude", () => {
    fs.mkdirSync(bundle("claude"), { recursive: true });
    fs.writeFileSync(path.join(bundle("claude"), ".credentials.json"), '{"placeholder":"x"}\n');
    try {
      assert.equal(ready("claude").rc, 0);
    } finally {
      fs.rmSync(bundle("claude"), { recursive: true, force: true });
    }
  });

  it("copilot config.json: workstation credential, token precedence, empty file is not ready", () => {
    const dir = bundle("copilot");
    fs.mkdirSync(dir, { recursive: true });
    const cfg = path.join(dir, "config.json");
    try {
      fs.writeFileSync(cfg, '{"placeholder":"x"}\n');
      assert.equal(ready("copilot").rc, 0);
      assert.equal(ready("copilot").credentialPath, "workstation-credential");

      const both = ready("copilot", { COPILOT_GITHUB_TOKEN: "primary" });
      assert.equal(both.rc, 0);
      assert.match(both.stderr, /COPILOT_GITHUB_TOKEN/);
      assert.doesNotMatch(both.stderr, /config\.json/);

      fs.writeFileSync(cfg, "");
      assert.equal(ready("copilot").rc, 78);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("copilot not-ready diagnostic names a command", () => {
    assert.match(ready("copilot").stderr, /copilot|task e2e:auth:copilot/i);
  });

  it("E2E_AUTH_READY_CREDENTIAL_PATH names the path actually selected", () => {
    assert.equal(
      ready("copilot", { COPILOT_GITHUB_TOKEN: "x" }).credentialPath,
      "COPILOT_GITHUB_TOKEN",
    );
    assert.equal(ready("copilot", { GH_TOKEN: "x" }).credentialPath, "GH_TOKEN");

    const key = path.join(bundle("ollama"), "id_ed25519");
    fs.mkdirSync(bundle("ollama"), { recursive: true });
    fs.writeFileSync(key, "fake-key\n");
    try {
      assert.equal(ready("copilot").credentialPath, "ollama-cloud-keypair");
    } finally {
      fs.rmSync(bundle("ollama"), { recursive: true, force: true });
    }

    assert.equal(ready("claude", { ANTHROPIC_API_KEY: "x" }).credentialPath, "ANTHROPIC_API_KEY");
    assert.equal(ready("gemini", { GEMINI_API_KEY: "x" }).credentialPath, "GEMINI_API_KEY");
    assert.equal(ready("copilot").credentialPath, "");
  });

  it("unknown CLI exits non-zero with a clear error", () => {
    assert.throws(
      () => ready("nonesuch"),
      (e: unknown) =>
        e instanceof ExitError &&
        e.status !== 0 &&
        /unknown|claude\|gemini\|copilot/i.test(e.stderr),
    );
  });
});

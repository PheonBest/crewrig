// e2e-auth-scripts.test.ts — migrated from test-e2e-auth-scripts.sh (docs/adr/0002-e2e-auth-flow.md);
// spec 0261 R19. The shebang, `set -euo pipefail`, `bash -n` and executable-bit checks are
// requirement-14 shell-text assertions and are dropped. Every run goes through the Docker stand-in
// with a scratch HOME and CREWRIG_E2E_HOME.

import assert from "node:assert/strict";
import path from "node:path";
import { after, describe, it } from "node:test";

import { makeScratch, put, REPO, runEntry, sandboxEnv } from "./lib/e2e-suite-kit.ts";

const s = makeScratch("crewrig-e2e-auth-scripts");
after(() => s.cleanup());
put(path.join(s.home, ".claude/rules/00-test.md"), "rule\n");
put(path.join(s.home, ".copilot/instructions/00-test.instructions.md"), "rule\n");
const fixtures = path.join(s.root, "fixtures.json");
put(
  fixtures,
  JSON.stringify({
    "auth/claude": [
      {
        files: { "/home/agent/.claude/.credentials.json": "{}", "/home/agent/.claude.json": "{}" },
      },
    ],
    "auth/gemini": [
      {
        files: {
          "/home/agent/.gemini/oauth_creds.json": "{}",
          "/home/agent/.gemini/settings.json": "{}",
        },
      },
    ],
    "auth/copilot": [{ stdout: "1.0.0\n" }],
  }),
);

let seq = 0;
function runAuth(cli: string, extra: Record<string, string> = {}) {
  seq += 1;
  const state = path.join(s.root, `state-${seq}`);
  put(path.join(state, ".keep"), "");
  const env = sandboxEnv(s, {
    CREWRIG_E2E_HOME: path.join(s.root, `e2e-${seq}`),
    E2E_STANDIN_FIXTURES: fixtures,
    E2E_STANDIN_CASE: `auth/${cli}`,
    E2E_STANDIN_STATE: state,
    E2E_STANDIN_LOG: path.join(state, "docker.log"),
    ...extra,
  });
  return runEntry(path.join(REPO, "scripts/e2e", `auth-${cli}.ts`), [], env);
}

describe("auth scripts: shared helpers are in effect", () => {
  for (const cli of ["claude", "gemini", "copilot"]) {
    it(`auth-${cli} — the image-missing error of e2e_require_image fires`, () => {
      const extra: Record<string, string> = {
        E2E_STANDIN_MISSING_IMAGES: `crewrig/e2e-${cli}:latest`,
      };
      if (cli === "copilot") extra["COPILOT_GITHUB_TOKEN"] = "dummy";
      const r = runAuth(cli, extra);
      assert.notEqual(r.status, 0, r.out);
      assert.match(r.out, new RegExp(`image 'crewrig/e2e-${cli}:latest' is not present locally`));
    });
  }
});

describe("interactive container scripts", () => {
  for (const cli of ["claude", "gemini"]) {
    it(`auth-${cli} — calls e2e_chown_bootstrap (writability line, rc=0)`, () => {
      const r = runAuth(cli);
      assert.equal(r.status, 0, r.out);
      assert.ok(r.out.includes(`[${cli}] Asserting writability on `), r.out);
    });

    it(`auth-${cli} — image-missing precondition fires with the build hint`, () => {
      const r = runAuth(cli, {
        E2E_STANDIN_MISSING_IMAGES: `crewrig/e2e-${cli}:latest`,
        E2E_STANDIN_FORBID_RUN: "1",
      });
      assert.notEqual(r.status, 0, r.out);
      assert.match(r.out, new RegExp(`e2e:build:${cli}`));
    });
  }
});

describe("auth-copilot guidance", () => {
  const r = (() => {
    let cached: ReturnType<typeof runAuth> | undefined;
    return () => (cached ??= runAuth("copilot"));
  })();
  it("exits 0 when only printing guidance", () => assert.equal(r().status, 0, r().out));
  it("contains the PAT-creation URL", () =>
    assert.ok(r().out.includes("github.com/settings/personal-access-tokens/new")));
  it("contains the export hint", () => assert.ok(r().out.includes("export COPILOT_GITHUB_TOKEN")));
  it("contains the 90-day expiry reminder", () => assert.match(r().out, /90[ -]?(DAYS|days)/));
});

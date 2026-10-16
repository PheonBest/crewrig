// setup-common-tier-built-pin.test.ts — ensure_tier_built() of scripts/lib/common.sh (spec 0107,
// issue #618) against a fake repository holding a stub scripts/build-components.sh. Ported from
// scripts/tests/test-setup-ensure-tier-built.sh groups G1-G3 (spec 0263, row A); G4 is
// setup-tier-staging-declared.test.ts. POSIX-only (Bash library, stub .sh build script).
// Retires with scripts/lib/common.sh (row J4).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { bashLibs } from "./lib/bash-libs.ts";
import { cleanEnv, realTmp, SKIP_POSIX } from "./lib/worktree-fixtures.ts";

let repo = "";

beforeEach(() => {
  repo = realTmp("crewrig-tier-built-");
  fs.mkdirSync(path.join(repo, "scripts"));
});
afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

function stubBuild(body: string): void {
  fs.writeFileSync(path.join(repo, "scripts", "build-components.sh"), `#!/bin/bash\n${body}\n`, {
    mode: 0o755,
  });
}

function ensure(tool: string, sub: string): ReturnType<typeof bashLibs> {
  const dir = path.join(repo, "dist", "library", sub);
  return bashLibs(
    `ensure_tier_built ${JSON.stringify(repo)} ${tool} ${JSON.stringify(dir)}`,
    {
      ...cleanEnv(),
      USERPROFILE: repo,
    },
    ["common.sh"],
  );
}

describe("ensure_tier_built of common.sh", { skip: SKIP_POSIX }, () => {
  it("G1: staging already built returns 0, never invokes the build, prints nothing on stdout", () => {
    fs.mkdirSync(path.join(repo, "dist/library/.gemini"), { recursive: true });
    stubBuild('echo "STUB: build-components.sh was invoked" >&2\nexit 1');
    const r = ensure("gemini", ".gemini");
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!r.stderr.includes("STUB: build-components.sh was invoked"), "the build ran");
    assert.equal(r.stdout, "");
  });

  it("G2: staging missing and build succeeds returns 0 with a 'not built' notice", () => {
    stubBuild('mkdir -p "$(dirname "$0")/../dist/library/.gemini"\nexit 0');
    const r = ensure("gemini", ".gemini");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr + r.stdout, /not built/);
  });

  it("G3: staging missing and build fails returns 1, ERROR names 'claude', staging stays absent", () => {
    stubBuild("exit 1");
    const r = ensure("claude", ".claude");
    assert.equal(r.status, 1);
    assert.match(r.stderr, /ERROR:.*claude/);
    assert.equal(fs.existsSync(path.join(repo, "dist/library/.claude")), false);
  });
});

// check-extension-pivot.test.ts — black-box edge cases of scripts/check-extension-pivot.ts
// not covered by the Bash suite (spec 0259). Each case asserts stdout, stderr and
// status byte for byte against the frozen output of the original shell script
// (recorded under LC_ALL=C on Linux).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = path.join(SCRIPTS, "check-extension-pivot.ts");

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Frozen {status, stdout, stderr} of the original shell script, one per check, in call order. */
const GOLDEN = JSON.parse(
  readFileSync(
    path.join(SCRIPTS, "tests", "fixtures", "governance-oracle", "extension-pivot.json.golden"),
    "utf8",
  ),
) as Run[];
let nextGolden = 0;
function frozen(): Run {
  const g = GOLDEN[nextGolden++];
  assert.ok(g, "frozen shell expectations exhausted");
  return g;
}

function run(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): Run {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", env: { ...process.env, ...env } });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** Run the TS entry in a fresh fixture tree; compare to the frozen shell output. */
function check(setup: (dir: string) => void): Run {
  const dir = mkdtempSync(path.join(tmpdir(), "ext-pivot-"));
  try {
    setup(dir);
    const ts = run(
      process.execPath,
      ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", ENTRY],
      dir,
    );
    assert.deepEqual(ts, frozen());
    return ts;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function put(dir: string, rel: string, body = ""): void {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  writeFileSync(path.join(dir, rel), body);
}

describe("check-extension-pivot edge cases", () => {
  it("passes with zero counts on an empty tier root", () => {
    const r = check((d) => mkdirSync(path.join(d, "extensions/core"), { recursive: true }));
    assert.equal(r.status, 0);
    assert.match(r.stdout, /\(0 command \.toml, 0 agent dir checked\)/);
  });

  it("accepts a stem with dots when its sibling .md exists, fails otherwise", () => {
    const r = check((d) => {
      put(d, "extensions/core/commands/a.b.toml");
      put(d, "extensions/core/commands/a.b.md");
      put(d, "extensions/library/commands/c.d.toml");
    });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /OK {3}extensions\/core\/commands\/a\.b\.toml/);
    assert.match(r.stdout, /no pivot sibling commands\/c\.d\.md/);
  });

  it("matches nested commands directories and only direct agent children", () => {
    const r = check((d) => {
      put(d, "extensions/core/pkg/commands/sub/n.toml");
      put(d, "extensions/core/agents/ok/AGENT.md");
      put(d, "extensions/core/agents/bad/README.md");
      put(d, "extensions/core/agents/ok/agents/deep/x.md");
    });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /FAIL extensions\/core\/pkg\/commands\/sub\/n\.toml/);
    assert.match(r.stdout, /OK {3}extensions\/core\/agents\/ok /);
    assert.match(r.stdout, /FAIL extensions\/core\/agents\/bad /);
    assert.ok(!r.stdout.includes("agents/deep"));
  });

  it("excludes a symlinked .toml from the command scan", () => {
    const r = check((d) => {
      put(d, "elsewhere/x.toml");
      mkdirSync(path.join(d, "extensions/core/commands"), { recursive: true });
      symlinkSync(
        path.join(d, "elsewhere/x.toml"),
        path.join(d, "extensions/core/commands/x.toml"),
      );
    });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /\(0 command \.toml/);
  });
});

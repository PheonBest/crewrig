// check-skill-versions.test.ts — black-box edge cases the Bash suite does not
// cover (spec 0259): unresolvable base, deleted, added and renamed sources.
// Each case asserts stdout, stderr and exit status byte for byte against the frozen
// output of the original shell script (recorded under LC_ALL=C on Linux).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = path.join(SCRIPTS, "check-skill-versions.ts");

const repo = mkdtempSync(path.join(tmpdir(), "skill-versions-"));
after(() => rmSync(repo, { recursive: true, force: true }));

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

const GIT_ENV = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.invalid",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.invalid",
};

/** Frozen {status, stdout, stderr} of the original shell script, one per check, in call order. */
const GOLDEN = JSON.parse(
  readFileSync(
    path.join(SCRIPTS, "tests", "fixtures", "governance-oracle", "skill-versions.json.golden"),
    "utf8",
  ),
) as Run[];
let nextGolden = 0;
function frozen(): Run {
  const g = GOLDEN[nextGolden++];
  assert.ok(g, "frozen shell expectations exhausted");
  return g;
}

function git(...args: string[]): void {
  const r = spawnSync("git", args, { cwd: repo, env: { ...process.env, ...GIT_ENV } });
  assert.equal(r.status, 0, String(r.stderr));
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv = {}): Run {
  const r = spawnSync(cmd, args, {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, ...env, BASE_REF: "" },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** Run the TypeScript entry; assert it matches the frozen shell output. */
function check(args: string[]): Run {
  const actual = run(process.execPath, [
    "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
    ENTRY,
    ...args,
  ]);
  assert.deepEqual(actual, frozen());
  return actual;
}

const skill = (name: string, version: string, body = "x"): string =>
  `---\nname: ${name}\nmetadata:\n  provenance:\n    version: "${version}"\n---\n${body}\n`;

function put(rel: string, content: string): void {
  const abs = path.join(repo, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

const SK = (n: string): string => `artifacts/core/skills/${n}/SKILL.md`;

describe("check-skill-versions edge cases", () => {
  before(() => {
    git("init", "-q", "-b", "main");
    put(SK("keep"), skill("keep", "1.0.0"));
    put(SK("gone"), skill("gone", "1.0.0"));
    put(SK("moved"), skill("moved", "1.0.0"));
    git("add", ".");
    git("commit", "-q", "-m", "base");
  });

  it("exits 2 with the frozen two-line diagnostic on an unresolvable base", () => {
    const r = check(["no-such-remote/zzz"]);
    assert.equal(r.status, 2);
    assert.equal(r.stdout, "");
    assert.equal(
      r.stderr,
      "Error: cannot resolve base ref 'no-such-remote/zzz' and  failed.\n" +
        "       Pass a resolvable ref as the first argument or via BASE_REF.\n",
    );
  });

  it("ignores added, deleted and renamed sources", () => {
    put(SK("fresh"), skill("fresh", "1.0.0")); // added, untracked then staged
    git("add", SK("fresh"));
    unlinkSync(path.join(repo, SK("gone"))); // deleted in the working tree
    mkdirSync(path.dirname(path.join(repo, SK("moved2"))), { recursive: true });
    renameSync(path.join(repo, SK("moved")), path.join(repo, SK("moved2")));
    git("add", "-A");
    const r = check(["HEAD"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^OK: no existing component sources modified vs HEAD\.\n$/);
  });

  it("fails a modified source without a bump and passes one with a bump", () => {
    put(SK("keep"), skill("keep", "1.0.0", "changed"));
    const failing = check(["HEAD"]);
    assert.equal(failing.status, 1);
    assert.match(failing.stdout, /FAIL artifacts\/core\/skills\/keep\/SKILL\.md/);
    put(SK("keep"), skill("keep", "1.0.1", "changed"));
    const passing = check(["HEAD"]);
    assert.equal(passing.status, 0);
    assert.match(passing.stdout, /OK {3}artifacts\/core\/skills\/keep\/SKILL\.md/);
  });
});

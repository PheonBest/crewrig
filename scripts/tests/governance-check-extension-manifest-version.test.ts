// check-extension-manifest-version.test.ts — black-box edge cases for
// scripts/check-extension-manifest-version.ts that the Bash suite does not cover (spec 0259 R14).
// Each case asserts stdout, stderr and exit status byte for byte against the frozen output of
// the original shell script, recorded on Ubuntu 24.04 under LC_ALL=C and stored in
// fixtures/governance-oracle/extension-manifest-version.json.golden.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = path.join(SCRIPTS, "check-extension-manifest-version.ts");
const GOLDEN = path.join(
  SCRIPTS,
  "tests",
  "fixtures",
  "governance-oracle",
  "extension-manifest-version.json.golden",
);

const tmp = mkdtempSync(path.join(tmpdir(), "ext-manifest-version-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

let counter = 0;
/** A tree of `tier/name -> [package.json text | null, extension.json text | null]`. */
function tree(
  spec: Record<string, [string | null, string | null]>,
  tiers = ["core", "library"],
): string {
  const root = path.join(tmp, `t${counter++}`);
  for (const tier of tiers) mkdirSync(path.join(root, "extensions", tier), { recursive: true });
  for (const [rel, [pkg, ext]] of Object.entries(spec)) {
    const dir = path.join(root, "extensions", rel);
    mkdirSync(dir, { recursive: true });
    if (pkg !== null) writeFileSync(path.join(dir, "package.json"), pkg);
    if (ext !== null) writeFileSync(path.join(dir, "extension.json"), ext);
  }
  return root;
}

function run(cmd: string, args: string[], cwd: string): Run {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", env: { ...process.env, LC_ALL: "C" } });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const frozen = JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, Run>;

function check(id: string, root: string): Run {
  const r = run(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", ENTRY], root);
  assert.deepEqual(r, frozen[id], `case ${id} diverges from the frozen original-shell output`);
  return r;
}

const v = (x: string): string => `{"version":${x}}`;

describe("check-extension-manifest-version", () => {
  it("an empty tree passes with zero extensions", () => {
    const r = check("c1", tree({}));
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^\nOK: 0 extension\(s\)/);
  });

  it("package.json without version fails and skips the sibling", () => {
    const r = check("c2", tree({ "core/a": ['{"name":"a"}', v('"1.0.0"')] }));
    assert.equal(r.status, 1);
    assert.match(r.stdout, /FAIL extensions\/core\/a\/package\.json — no \.version field/);
  });

  it("null, false and empty-string versions are all empty", () => {
    for (const bad of ["null", "false", '""']) {
      const r = check(`c3-${bad}`, tree({ "core/a": [v(bad), null] }));
      assert.equal(r.status, 1, bad);
    }
  });

  it("a non-string truthy version compares as jq prints it", () => {
    assert.equal(check("c4", tree({ "core/a": [v("1"), v('"1"')] })).status, 0);
    assert.equal(check("c5", tree({ "core/a": [v("true"), v('"true"')] })).status, 0);
    assert.equal(check("c6", tree({ "core/a": [v("2"), v('"1"')] })).status, 1);
  });

  it("a diverging extension.json names the offender and both versions", () => {
    const r = check("c7", tree({ "library/b": [v('"1.0.0"'), v('"2.0.0"')] }));
    assert.equal(r.status, 1);
    assert.match(r.stdout, /version '2\.0\.0' != authoritative package\.json version '1\.0\.0'/);
    assert.match(r.stdout, /FAILED: 1 manifest\(s\)/);
  });

  it("an absent extension.json is not a divergence; extensions sort by code unit", () => {
    const r = check(
      "c8",
      tree({
        "library/z": [v('"1.0.0"'), null],
        "core/B": [v('"1.0.0"'), null],
        "core/a": [v('"1.0.0"'), null],
      }),
    );
    assert.equal(r.status, 0);
    const oks = r.stdout.split("\n").filter((l) => l.startsWith("  OK"));
    assert.deepEqual(
      oks.map((l) => l.split(" ")[5]),
      ["extensions/core/B", "extensions/core/a", "extensions/library/z"],
    );
  });

  it("the org tier is exempt", () => {
    const r = check(
      "c9",
      tree({ "org/o": [v('"1.0.0"'), v('"9.9.9"')] }, ["core", "library", "org"]),
    );
    assert.equal(r.status, 0);
  });

  it("a retired components object fails with a VALIDATION-ERROR on stderr", () => {
    const r = check(
      "c10",
      tree({ "core/a": [v('"1.0.0"'), '{"version":"1.0.0","components":{"skills":{}}}'] }),
    );
    assert.equal(r.status, 1);
    assert.match(
      r.stderr,
      /^VALIDATION-ERROR: extensions\/core\/a\/extension\.json — declares the retired 'components' object/,
    );
  });
});

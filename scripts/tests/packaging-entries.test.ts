// packaging-entries.test.ts — `package-extension` and `package-extensions` (spec 0257 R12): the
// EXT contract, the version read, the cleared output directory, the tier walk in byte order that
// stops at the first failure. The entry-level proof against the goldens is packaging-release-differential.test.ts.

import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

import { readTarGz } from "./lib/tar-reader.ts";
import {
  addExtension,
  baseEnv,
  emptyPath,
  makeSandbox,
  NAME,
  runEntry,
  stubBuilder,
  treeOfDir,
  twoPerTier,
} from "./lib/release-sandbox.ts";
import type { EntryName, Sandbox } from "./lib/release-sandbox.ts";

function run(sandbox: Sandbox, entry: EntryName, args: string[], extra: NodeJS.ProcessEnv = {}) {
  return runEntry(sandbox, entry, args, { ...baseEnv(emptyPath()), ...extra });
}

function archives(sandbox: Sandbox): string[] {
  return Object.keys(treeOfDir(sandbox.resolve("dist/release")))
    .filter((rel) => rel.endsWith(".tar.gz"))
    .sort();
}

test("package-extension: EXT unset or empty is refused on stdout, as the shell's echo", () => {
  const sandbox = makeSandbox();
  for (const env of [{}, { EXT: "" }]) {
    const res = run(sandbox, "package-one", [], env);
    assert.equal(res.status, 1);
    assert.equal(res.stdout, "Error: EXT variable is required (e.g., EXT=hello-world).\n");
    assert.equal(res.stderr, "");
  }
});

test("package-extension: an unknown extension and a name in two tiers are refused", () => {
  const sandbox = makeSandbox();
  const unknown = run(sandbox, "package-one", [], { EXT: "nope" });
  assert.equal(unknown.status, 1);
  assert.equal(unknown.stderr, "Error: extension 'nope' not found.\n");
  assert.equal(unknown.stdout, "");

  addExtension(sandbox, "library", NAME);
  const twice = run(sandbox, "package-one", [], { EXT: NAME });
  assert.equal(twice.status, 1);
  assert.equal(
    twice.stderr,
    `Error: extension '${NAME}' exists in multiple tiers; names must be unique.\n`,
  );
});

test("package-extension: a manifest without a version is refused, null and false included", () => {
  const sandbox = makeSandbox();
  const manifest = `extensions/core/${NAME}/extension.json`;
  const original = JSON.parse(sandbox.read(manifest)) as Record<string, unknown>;
  for (const version of [undefined, null, false]) {
    sandbox.write(manifest, JSON.stringify({ ...original, version }));
    const res = run(sandbox, "package-one", [], { EXT: NAME });
    assert.equal(res.status, 1);
    assert.equal(
      res.stderr,
      `Error: ${sandbox.resolve(manifest)} carries no .version.\n`,
      String(version),
    );
  }
  assert.equal(sandbox.exists(`dist/release/${NAME}`), false);
});

test("package-extension: a manifest jq cannot use ends silently with jq's status", () => {
  const sandbox = makeSandbox();
  const manifest = `extensions/core/${NAME}/extension.json`;
  sandbox.remove(manifest);
  assert.deepEqual(run(sandbox, "package-one", [], { EXT: NAME }), {
    status: 2,
    stdout: "",
    stderr: "",
  });
  for (const text of ["[1]", "{bad"]) {
    sandbox.write(manifest, text);
    assert.deepEqual(run(sandbox, "package-one", [], { EXT: NAME }), {
      status: 5,
      stdout: "",
      stderr: "",
    });
  }
});

test("package-extension: success writes the archive and clears a stale file first", () => {
  const sandbox = makeSandbox();
  sandbox.write(`dist/release/${NAME}/stale.txt`, "left over from an earlier release");
  sandbox.write(`dist/release/${NAME}/sub/deeper.txt`, "x");
  const res = run(sandbox, "package-one", [], { EXT: NAME });
  assert.equal(res.status, 0, res.stderr);
  const archive = `dist/release/${NAME}/${NAME}-${sandbox.version}.tar.gz`;
  assert.deepEqual(Object.keys(treeOfDir(sandbox.resolve(`dist/release/${NAME}`))), [
    `${NAME}-${sandbox.version}.tar.gz`,
  ]);
  assert.ok(
    readTarGz(sandbox.resolve(archive)).some((r) => r.path.endsWith("gemini-extension.json")),
  );
  assert.ok(res.stdout.includes(`Packaged: ${sandbox.resolve(archive)}\n`), res.stdout);
});

test("package-extension: an EXT that is a path, not a name, is refused and removes nothing", () => {
  const sandbox = makeSandbox();
  fs.mkdirSync(sandbox.resolve("extensions/core/a"), { recursive: true });
  const res = run(sandbox, "package-one", [], { EXT: "." });
  assert.notEqual(res.status, 0);
  assert.ok(sandbox.exists("extensions/core"));
});

test("package-extensions: core then library, each in byte order, org left out", () => {
  const sandbox = makeSandbox();
  twoPerTier(sandbox);
  addExtension(sandbox, "core", "Upper");
  const res = run(sandbox, "package-all", []);
  assert.equal(res.status, 0, res.stderr);
  const packaged = [...res.stdout.matchAll(/^Packaged: .*\/([^/]+)\.tar\.gz$/gm)].map((m) => m[1]);
  assert.deepEqual(
    packaged.map((p) => String(p).replace(`-${sandbox.version}`, "")),
    ["Upper", NAME, "zz-core", "aa-lib", "ab-lib"],
  );
  assert.equal(archives(sandbox).length, 5);
});

test("package-extensions: --include-org and a non-empty INCLUDE_ORG add the org tier", () => {
  for (const [args, extra] of [
    [["--include-org"], {}],
    [[], { INCLUDE_ORG: "1" }],
  ] as const) {
    const sandbox = makeSandbox();
    twoPerTier(sandbox);
    const res = run(sandbox, "package-all", [...args], extra);
    assert.equal(res.status, 0, res.stderr);
    assert.ok(sandbox.exists(`dist/release/org-ext/org-ext-${sandbox.version}.tar.gz`));
  }
  const sandbox = makeSandbox();
  twoPerTier(sandbox);
  const res = run(sandbox, "package-all", ["--other"], { INCLUDE_ORG: "" });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(sandbox.exists("dist/release/org-ext"), false);
});

test("package-extensions: stops at the first failure, leaving the earlier archives", () => {
  const sandbox = makeSandbox();
  addExtension(sandbox, "core", "hello-xtra");
  addExtension(sandbox, "library", "lib-one");
  stubBuilder(sandbox, ["hello-xtra"]);
  const res = run(sandbox, "package-all", []);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /Error: a fresh --target gemini render failed for 'hello-xtra'/);
  assert.deepEqual(archives(sandbox), [`${NAME}/${NAME}-${sandbox.version}.tar.gz`]);
});

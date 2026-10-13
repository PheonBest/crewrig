// windows-packaging-cases.ts — the documentation index, manifest synchronisation and packaging cases
// of the cross-system proof (spec 0257 R27: `wp-docs-*`, `wp-sync-manifests`, `wp-package-*`,
// `wp-release-package`). Each case runs its entry through the interpreter of `windows-packaging-driver`
// and asserts observable outcomes only: exit status, output lines, written bytes. The Linux golden of
// the documentation index (`scripts/tests/fixtures/packaging-release/`) is not in this tree yet, so
// `INDEX_GOLDEN` is an in-test expected string; the Linux black-box suites hold the same bytes.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { createFixtureTree, REPO } from "./build-fixture-tree.ts";
import { createReleaseSandbox } from "./release-driver-sandbox.ts";
import { readTarGz } from "./tar-reader.ts";
import {
  attempt,
  baseEnv,
  childPath,
  land,
  lines,
  runEntry,
  writeBins,
} from "./windows-packaging-driver.ts";
import type { Bins, Proof } from "./windows-packaging-driver.ts";
import { expectStatus, why, WIN } from "./windows-proof-support.ts";
import type { Run, Shell } from "./windows-proof-support.ts";

const page = (section: string, nav: number, title: string): string =>
  [
    "# Title",
    "",
    `<!-- crewrig-doc: section=${section} nav_order=${nav} published=true title="${title}" -->`,
    "",
    "Body.",
    "",
  ].join("\r\n");

const INDEX_GOLDEN = `{
  "version": 1,
  "sections": [
    {
      "section": "introduction",
      "title": "Introduction",
      "pages": [
        {
          "title": "Intro page",
          "path": "docs/intro.md",
          "nav_order": 1
        }
      ]
    },
    {
      "section": "concepts",
      "title": "Concepts",
      "pages": [
        {
          "title": "Setup guide",
          "path": "docs/guide/setup.md",
          "nav_order": 2
        },
        {
          "title": "Zeta",
          "path": "docs/guide/zeta.md",
          "nav_order": 2
        }
      ]
    }
  ]
}
`;

/** What every case shares: the proof's books, the interpreters, a scratch directory, the bins. */
export interface Cases {
  readonly proof: Proof;
  readonly tmp: string;
  readonly bins: Bins;
}

function env(c: Cases, extra: Record<string, string> = {}): Record<string, string> {
  const pathValue = childPath([c.bins.dir], process.env["PATH"] ?? "", {
    platform: process.platform,
    systemRoot: process.env["SystemRoot"] ?? "C:\\Windows",
    isFile: (file) => fs.existsSync(file),
  });
  return baseEnv(pathValue, path.join(c.tmp, "home"), c.tmp, extra);
}

function run(c: Cases, root: string, entry: string, args: string[], shell: Shell, extra = {}): Run {
  return runEntry({
    script: path.join(root, "scripts", `${entry}.ts`),
    args,
    cwd: root,
    shell,
    env: env(c, extra),
    interpreters: c.proof.interpreters,
  });
}

function docsCases(c: Cases): void {
  const tree = createFixtureTree({ deps: "none" });
  try {
    tree.write("docs/intro.md", page("introduction", 1, "Intro page"));
    tree.write("docs/guide/zeta.md", page("concepts", 2, "Zeta"));
    tree.write("docs/guide/setup.md", page("concepts", 2, "Setup guide"));
    tree.write("docs/draft.md", "# D\r\n\r\n<!-- crewrig-doc: published=false -->\r\n");
    const index = tree.resolve("docs/index.json");
    attempt(c.proof, "wp-docs-write", () => {
      const res = run(c, tree.root, "build-docs-index", [], "pwsh");
      expectStatus(res, 0);
      assert.match(res.out, /^Wrote docs\/index\.json \(3 published pages\)\.$/m, why(res, "line"));
      assert.equal(fs.readFileSync(index, "utf8"), INDEX_GOLDEN, "a CRLF tree gives the LF golden");
      land(c.proof, index);
    });
    attempt(c.proof, "wp-docs-check-ok", () => {
      const res = run(c, tree.root, "build-docs-index", ["--check"], "cmd");
      expectStatus(res, 0);
      assert.match(
        res.out,
        /^OK: docs\/index\.json is up to date \(3 published pages\)\.$/m,
        why(res, "line"),
      );
    });
    attempt(c.proof, "wp-docs-drift", () => {
      fs.writeFileSync(index, INDEX_GOLDEN.replace("Zeta", "Zed"));
      const res = run(c, tree.root, "build-docs-index", ["--check"], "pwsh");
      expectStatus(res, 1);
      assert.match(res.err, /^Drift: docs\/index\.json is stale\./m, why(res, "drift line"));
      assert.ok(res.err.includes("Zeta"), why(res, "the line diff names the expected side"));
      assert.equal(fs.readFileSync(index, "utf8").includes("Zed"), true, "--check never rewrites");
    });
    attempt(c.proof, "wp-docs-lint-fail", () => {
      tree.write("docs/bad.md", "# Bad\r\n\r\nno metadata here\r\n");
      const res = run(c, tree.root, "build-docs-index", [], "cmd");
      expectStatus(res, 1);
      const want =
        "Documentation publication contract violations:\n  - docs/bad.md: no crewrig-doc metadata block found";
      assert.ok(res.err.includes(want), why(res, "the violation list"));
    });
  } finally {
    tree.dispose();
  }
}

function syncCase(c: Cases): void {
  attempt(c.proof, "wp-sync-manifests", () => {
    const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(c.tmp, "sync-")));
    fs.writeFileSync(
      path.join(dir, "package.json"),
      '{\r\n    "name": "x",\r\n    "version": "1.0.0"\r\n}\r\n',
    );
    fs.writeFileSync(path.join(dir, "extension.json"), '{"name":"x","version":"1.0.0"}');
    const res = runEntry({
      script: path.join(REPO, "scripts", "release-sync-manifests.ts"),
      args: ["2.3.4"],
      cwd: dir,
      shell: "pwsh",
      env: env(c),
      interpreters: c.proof.interpreters,
    });
    expectStatus(res, 0);
    for (const name of ["package.json", "extension.json"]) {
      const text = fs.readFileSync(path.join(dir, name), "utf8");
      assert.equal(text, '{\n  "name": "x",\n  "version": "2.3.4"\n}\n', `${name}: two spaces, LF`);
      land(c.proof, path.join(dir, name));
    }
  });
}

/** The records of an archive: `./gemini-extension.json` at the root, modes by the `#!` rule, OS byte 3. */
function assertArchive(c: Cases, archive: string, expectShebang: boolean): void {
  assert.ok(fs.existsSync(archive), `${archive} was not written`);
  assert.equal(fs.readFileSync(archive)[9], 3, "the gzip OS byte is 3 (Unix) on every host");
  const records = readTarGz(archive);
  const root = records.find((r) => r.path === "./gemini-extension.json");
  assert.ok(
    root !== undefined,
    `no ./gemini-extension.json at the root: ${records.map((r) => r.path).join(", ")}`,
  );
  c.proof.landed.push({ label: `${archive}!gemini-extension.json`, bytes: root.data });
  const shebang = records.filter(
    (r) => r.type === "file" && r.data.subarray(0, 2).toString() === "#!",
  );
  if (expectShebang)
    assert.ok(
      shebang.length > 0,
      "the extension carries no shebang file: the 0755 rule is not exercised",
    );
  for (const r of records.filter((x) => x.type === "file")) {
    const mode = r.mode & 0o777;
    assert.ok(mode === 0o644 || mode === 0o755, `${r.path} has mode ${mode.toString(8)}`);
    // Only win32 derives the exec bit from the `#!` rule; a POSIX host copies the source's bit.
    if (WIN) assert.equal(mode, shebang.includes(r) ? 0o755 : 0o644, `${r.path}: the #! rule`);
  }
}

function packageCases(c: Cases): void {
  const sb = createReleaseSandbox();
  try {
    const version = (
      JSON.parse(
        fs.readFileSync(path.join(sb.root, "extensions/core/hello-world/extension.json"), "utf8"),
      ) as { version: string }
    ).version;
    const runIn = (
      entry: string,
      args: string[],
      shell: Shell,
      extra: Record<string, string> = {},
    ): Run => run(c, sb.root, entry, args, shell, extra);
    attempt(c.proof, "wp-package-one", () => {
      const res = runIn("package-extension", [], "pwsh", { EXT: "hello-world" });
      expectStatus(res, 0);
      const archive = path.join(
        sb.root,
        "dist",
        "release",
        "hello-world",
        `hello-world-${version}.tar.gz`,
      );
      assert.ok(res.out.includes("Packaged: "), why(res, "the Packaged line"));
      assertArchive(c, archive, true);
    });
    attempt(c.proof, "wp-package-all", () => {
      const res = runIn("package-extensions", [], "cmd");
      expectStatus(res, 0);
      const packaged = res.out.split("\n").filter((l) => l.startsWith("Packaged: "));
      assert.equal(packaged.length, 2, why(res, "one Packaged line per extension"));
      assert.ok(packaged[0]?.includes("hello-world-"), why(res, "byte order: hello-world first"));
      assertArchive(
        c,
        path.join(sb.root, "dist", "release", "second-ext", "second-ext-0.4.0.tar.gz"),
        false,
      );
    });
    attempt(c.proof, "wp-release-package", () => {
      const out = path.join(sb.root, "release out");
      const res = runIn(
        "release-package-extension",
        ["hello-world", "--version", version, "--out", out],
        "pwsh",
      );
      expectStatus(res, 0);
      assert.match(
        res.out,
        /^ {2}gemini extensions validate: OK$/m,
        why(res, "the fake gemini on PATH"),
      );
      assertArchive(c, path.join(out, `hello-world-${version}.tar.gz`), true);
    });
  } finally {
    sb.dispose();
  }
}

/** Run the documentation, synchronisation and packaging cases. */
export function runPackagingCases(proof: Proof, tmp: string): Bins {
  const bins = writeBins(path.join(tmp, "bin"), true);
  const cases: Cases = { proof, tmp, bins };
  fs.mkdirSync(path.join(tmp, "home"), { recursive: true });
  docsCases(cases);
  syncCase(cases);
  packageCases(cases);
  return bins;
}

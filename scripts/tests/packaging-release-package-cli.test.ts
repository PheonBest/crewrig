// packaging-release-package-cli.test.ts — the best-effort `gemini extensions validate` and the
// argument parsing of `release-package-extension` (spec 0257 R9, R10). The assertions and the
// archive are in packaging-release-package.test.ts. The differential run against the shell tool was
// retired with the switch: that script is now a shim of the TypeScript entry, so the comparison
// would be the entry against itself (the goldens of packaging-release-differential.test.ts remain).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { main } from "../lib/packaging/release-package-main.ts";
import type { Io } from "../lib/extension/types.ts";
import {
  baseEnv,
  emptyPath,
  fakeGeminiPath,
  makeSandbox,
  REPO,
  runPackager,
} from "./lib/release-sandbox.ts";

const NAME = "hello-world";

test("gemini on PATH: validate OK is reported and its output stays out of ours", () => {
  const sandbox = makeSandbox();
  const fake = fakeGeminiPath();
  const env = { ...baseEnv(fake.dir), FAKE_GEMINI_LOG: fake.log };
  const res = runPackager(sandbox, [NAME, "--version", sandbox.version, "--out", "o"], env);
  assert.equal(res.status, 0, res.stderr);
  assert.ok(res.stdout.split("\n").includes("  gemini extensions validate: OK"), res.stdout);
  assert.ok(!res.stdout.includes("FAKE-GEMINI") && !res.stderr.includes("FAKE-GEMINI"));
  const built = path.join(sandbox.root, "build", "extensions", NAME);
  assert.equal(fs.readFileSync(fake.log, "utf8"), `extensions validate ${built}\n`);
});

test("gemini failing is a non-fatal issue on stderr and the archive is still written", () => {
  const sandbox = makeSandbox();
  const fake = fakeGeminiPath();
  const env = { ...baseEnv(fake.dir), FAKE_GEMINI_LOG: fake.log, FAKE_GEMINI_EXIT: "3" };
  const res = runPackager(sandbox, [NAME, "--version", sandbox.version, "--out", "o"], env);
  assert.equal(res.status, 0, res.stderr);
  const built = path.join(sandbox.root, "build", "extensions", NAME);
  assert.ok(
    res.stderr.includes(
      `  gemini extensions validate: reported an issue (non-fatal, best-effort only) — re-run manually against ${built} for detail.`,
    ),
    res.stderr,
  );
  assert.ok(!res.stdout.includes("gemini extensions validate"));
  assert.ok(fs.existsSync(sandbox.resolve(`o/${NAME}-${sandbox.version}.tar.gz`)));
});

test("gemini absent: the skip line is printed and nothing is run", () => {
  const sandbox = makeSandbox();
  const res = runPackager(
    sandbox,
    [NAME, "--version", sandbox.version, "--out", "o"],
    baseEnv(emptyPath()),
  );
  assert.equal(res.status, 0, res.stderr);
  assert.ok(
    res.stdout
      .split("\n")
      .includes(
        "  gemini CLI not on PATH — skipping the best-effort 'gemini extensions validate' check.",
      ),
  );
});

function capture(): { io: Io; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: { out: (l) => out.push(l), err: (l) => err.push(l), errRaw: (t) => err.push(t) },
  };
}

const USAGE = "Usage: release-package-extension.sh <name> --version <v> --out <dir>";

async function parse(argv: string[]): Promise<{ status: number; out: string[]; err: string[] }> {
  const cap = capture();
  const status = await main({
    argv,
    env: {},
    platform: process.platform,
    entryFile: path.join(REPO, "scripts", "release-package-extension.ts"),
    io: cap.io,
  });
  return { status, out: cap.out, err: cap.err };
}

test("argument parsing refuses what the shell refuses, with its messages", async () => {
  const cases: [string[], string][] = [
    [[], USAGE],
    [["x"], USAGE],
    [["x", "--version", "1.0.0"], USAGE],
    [["--version", "1.0.0", "--out", "o"], USAGE],
    [["x", "--version"], USAGE],
    [["x", "--version", "1.0.0", "--out"], USAGE],
    [["x", "--version", "", "--out", "o"], USAGE],
    [["x", "--version", "1.0.0", "--out", "o", "y"], "Error: unexpected argument 'y'"],
    [["x", "y", "--version", "1.0.0", "--out", "o"], "Error: unexpected argument 'y'"],
  ];
  for (const [argv, message] of cases) {
    const got = await parse(argv);
    assert.deepEqual(got, { status: 1, out: [], err: [message] }, JSON.stringify(argv));
  }
});

test("the flags may come before the name and a repeated flag keeps the last value", () => {
  const sandbox = makeSandbox();
  const res = runPackager(
    sandbox,
    ["--out", "ignored", "--version", "0.0.1", NAME, "--out", "o", "--version", sandbox.version],
    baseEnv(emptyPath()),
  );
  assert.equal(res.status, 0, res.stderr);
  assert.ok(fs.existsSync(sandbox.resolve(`o/${NAME}-${sandbox.version}.tar.gz`)));
  assert.equal(fs.existsSync(sandbox.resolve("ignored")), false);
});

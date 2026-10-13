// packaging-release-package-cli.test.ts — the best-effort `gemini extensions validate`, the
// argument parsing of `release-package-extension`, and a differential run against the shell tool
// it replaces (spec 0257 R9, R10). The assertions and the archive are in
// packaging-release-package.test.ts.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
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
  toolPath,
  treeOfArchive,
  treeOfDir,
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

// --- differential against scripts/release-package-extension.sh ----------------------------------

const probe = (cmd: string): boolean => spawnSync(cmd, ["--version"]).error === undefined;
const skipShell =
  process.platform === "win32" || !["bash", "jq", "tar"].every(probe)
    ? "skipped: the shell oracle needs bash, jq and tar on a POSIX host"
    : false;

const SHELL_TOOLS = [
  "bash",
  "node",
  "jq",
  "tar",
  "dirname",
  "find",
  "wc",
  "tr",
  "mkdir",
  "paste",
  "cat",
];

interface Scenario {
  readonly title: string;
  readonly setup?: (sandbox: ReturnType<typeof makeSandbox>) => void;
  readonly args: (version: string) => string[];
  readonly gemini?: "ok" | "fail";
}

const SCENARIOS: Scenario[] = [
  { title: "success", args: (v) => [NAME, "--version", v, "--out", "out"] },
  {
    title: "success with gemini validating",
    gemini: "ok",
    args: (v) => [NAME, "--version", v, "--out", "out"],
  },
  {
    title: "success with gemini failing",
    gemini: "fail",
    args: (v) => [NAME, "--version", v, "--out", "out"],
  },
  { title: "version mismatch", args: () => [NAME, "--version", "9.9.9", "--out", "out"] },
  {
    title: "output directory already holds files",
    setup: (s) => {
      s.write("out/a.txt", "a");
      s.write("out/b.txt", "b");
    },
    args: (v) => [NAME, "--version", v, "--out", "out"],
  },
  { title: "unknown extension", args: () => ["nope", "--version", "1.0.0", "--out", "out"] },
  {
    title: "name in two tiers",
    setup: (s) =>
      fs.cpSync(s.resolve(`extensions/core/${NAME}`), s.resolve(`extensions/library/${NAME}`), {
        recursive: true,
      }),
    args: (v) => [NAME, "--version", v, "--out", "out"],
  },
  {
    title: ".releaserc.json in the source tree",
    setup: (s) => s.write(`extensions/core/${NAME}/.releaserc.json`, "{}\n"),
    args: (v) => [NAME, "--version", v, "--out", "out"],
  },
];

function extract(archive: string): Record<string, string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-extract-"));
  try {
    const res = spawnSync("tar", ["-xzf", archive, "-C", dir]);
    assert.equal(res.status, 0, String(res.stderr));
    return treeOfDir(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

for (const scenario of SCENARIOS) {
  test(`differential against the shell: ${scenario.title}`, { skip: skipShell }, () => {
    const shell = makeSandbox();
    const port = makeSandbox();
    for (const sandbox of [shell, port]) scenario.setup?.(sandbox);

    const fake = scenario.gemini === undefined ? undefined : fakeGeminiPath();
    const tools = toolPath(SHELL_TOOLS);
    const env: NodeJS.ProcessEnv = {
      ...baseEnv(fake === undefined ? tools : `${fake.dir}${path.delimiter}${tools}`),
      LC_ALL: "C",
      ...(fake === undefined
        ? {}
        : {
            FAKE_GEMINI_LOG: fake.log,
            FAKE_GEMINI_EXIT: scenario.gemini === "fail" ? "1" : "0",
          }),
    };
    const args = scenario.args(shell.version);

    const oracle = spawnSync("bash", ["scripts/release-package-extension.sh", ...args], {
      cwd: shell.root,
      env,
      encoding: "utf8",
    });
    const ported = runPackager(port, args, env);

    const normalise = (text: string, root: string): string => text.split(root).join("<ROOT>");
    assert.equal(ported.status, oracle.status);
    assert.equal(normalise(ported.stdout, port.root), normalise(oracle.stdout, shell.root));
    assert.equal(normalise(ported.stderr, port.root), normalise(oracle.stderr, shell.root));

    const archive = `out/${NAME}-${shell.version}.tar.gz`;
    assert.equal(port.exists(archive), shell.exists(archive));
    if (shell.exists(archive)) {
      assert.deepEqual(extract(port.resolve(archive)), extract(shell.resolve(archive)));
      assert.deepEqual(treeOfArchive(port.resolve(archive)), extract(shell.resolve(archive)));
    }
    assert.equal(port.exists("out"), shell.exists("out"));
    if (shell.exists("out")) {
      assert.deepEqual(
        Object.keys(treeOfDir(port.resolve("out"))),
        Object.keys(treeOfDir(shell.resolve("out"))),
      );
    }
  });
}

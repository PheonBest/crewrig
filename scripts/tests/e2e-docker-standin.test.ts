// e2e-docker-standin.test.ts — the Docker stand-in and the normaliser of the end-to-end oracle
// (spec 0261 R5, R7, R8): launcher, ordinal fixtures, bind-mount writes, loud failures, placeholders.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { writeLauncher } from "./lib/e2e-docker-standin.ts";
import { REPO_ROOT, normalise, normaliseArgv } from "./lib/e2e-normalise.ts";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

function setup(table: unknown, extra: Record<string, string> = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "standin-test-")));
  dirs.push(root);
  const fixtures = path.join(root, "fixtures.json");
  fs.writeFileSync(fixtures, JSON.stringify(table));
  const { posix } = writeLauncher(path.join(root, "bin"));
  const env = {
    PATH: process.env.PATH ?? "",
    E2E_STANDIN_FIXTURES: fixtures,
    E2E_STANDIN_CASE: "s/claude",
    E2E_STANDIN_STATE: path.join(root, "state"),
    E2E_STANDIN_LOG: path.join(root, "log.jsonl"),
    ...extra,
  };
  const docker = (...args: string[]) => spawnSync(posix, args, { env, encoding: "utf8" });
  return { root, docker, env };
}

describe("launcher", () => {
  it("writes an executable docker and a docker.cmd", () => {
    const { root } = setup({});
    const posix = path.join(root, "bin", "docker");
    assert.equal(fs.statSync(posix).mode & 0o777, 0o755);
    const text = fs.readFileSync(posix, "utf8");
    assert.ok(text.startsWith("#!/bin/sh\n"));
    assert.ok(
      text.includes(`exec "${process.execPath}" --disable-warning=MODULE_TYPELESS_PACKAGE_JSON`),
    );
    assert.ok(text.includes("e2e-docker-standin.ts"));
    assert.ok(fs.readFileSync(path.join(root, "bin", "docker.cmd"), "utf8").includes("%*"));
  });
});

describe("fixtures", () => {
  it("consumes entries by ordinal and logs each call", () => {
    const { root, docker } = setup({
      "s/claude": [
        { match: ["run"], stdout: "one\n", exit: 3 },
        { stdout: "two\n", stderr: "warn\n" },
      ],
    });
    const a = docker("run", "img");
    assert.deepEqual([a.status, a.stdout], [3, "one\n"]);
    const b = docker("exec", "x");
    assert.deepEqual([b.status, b.stdout, b.stderr], [0, "two\n", "warn\n"]);
    const lines = fs.readFileSync(path.join(root, "log.jsonl"), "utf8").trim().split("\n");
    assert.deepEqual(
      lines.map((l): unknown => JSON.parse(l)),
      [
        { ordinal: 0, argv: ["run", "img"], exit: 3 },
        { ordinal: 1, argv: ["exec", "x"], exit: 0 },
      ],
    );
  });

  it("writes files through the longest bind mount", () => {
    const { root, docker } = setup({
      "s/claude": [{ files: { "/out/deep/result.json": "{}" } }],
    });
    const outer = path.join(root, "outer");
    const inner = path.join(root, "inner");
    const r = docker("run", "-v", `${outer}:/out`, "-v", `${inner}:/out/deep:rw`, "img");
    assert.equal(r.status, 0);
    assert.equal(fs.readFileSync(path.join(inner, "result.json"), "utf8"), "{}");
    assert.equal(fs.existsSync(path.join(outer, "deep")), false);
  });

  it("exits 97 when no fixture is left", () => {
    const { docker } = setup({ "s/claude": [] });
    const r = docker("run", "img");
    assert.equal(r.status, 97);
    assert.equal(r.stderr, "standin: missing fixture s/claude#0\n");
  });

  it("exits 99 on run when forbidden, and logs it", () => {
    const { root, docker } = setup({}, { E2E_STANDIN_FORBID_RUN: "1" });
    const r = docker("run", "img");
    assert.equal(r.status, 99);
    assert.equal(r.stderr, "standin: docker run forbidden\n");
    assert.ok(fs.readFileSync(path.join(root, "log.jsonl"), "utf8").includes('"exit":99'));
  });

  it("answers image inspect, and reports a missing image", () => {
    const { docker } = setup({}, { E2E_STANDIN_MISSING_IMAGES: "gone:1,other" });
    assert.equal(docker("image", "inspect", "here:1").status, 0);
    const r = docker("image", "inspect", "gone:1");
    assert.equal(r.status, 1);
    assert.equal(r.stderr, "Error: No such image: gone:1\n");
    for (const argv of [
      ["version"],
      ["volume", "create", "v"],
      ["rm", "-f", "c"],
      ["network", "ls"],
    ]) {
      assert.equal(docker(...argv).status, 0);
    }
  });
});

describe("normalise", () => {
  const ctx = { tmp: "/scratch/t", home: "/scratch/t/home", e2eHome: "/scratch/t/bundle" };
  it("rewrites each rule", () => {
    const text = [
      process.execPath,
      "run 20260102T030405Z-ab12",
      "at 2026-01-02T03:04:05Z",
      "dir /scratch/t/x",
      "home /scratch/t/home/y",
      "e2e /scratch/t/bundle/z",
      "url http://localhost:41234/p",
      "name crewrig-e2e-claude-20260102T030405Z-ab12",
      "tmp /scratch/t/tmp/crewrig-e2e-probe-b.tnKtFY:/x",
      "nonce crewrig-probe-b-baseline-0123456789abcdef",
      `repo ${REPO_ROOT}/tests/e2e/run.sh`,
    ].join("\n");
    assert.equal(
      normalise(text, ctx),
      [
        "<NODE>",
        "run <RUN_ID>",
        "at <TS>",
        "dir <TMP>/x",
        "home <HOME>/y",
        "e2e <E2E_HOME>/z",
        "url http://localhost:<PORT>/p",
        "name <CONTAINER>",
        "tmp <TMP>/tmp/crewrig-e2e-probe-b.<RAND>:/x",
        "nonce crewrig-probe-b-baseline-<NONCE>",
        "repo <REPO>/tests/e2e/run.sh",
      ].join("\n"),
    );
  });
  it("normalises argv element-wise", () => {
    assert.deepEqual(normaliseArgv(["-v", "/scratch/t/a:/b"], ctx), ["-v", "<TMP>/a:/b"]);
  });
});

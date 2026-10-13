// release-driver-sandbox.test.ts — smoke test of the black-box suite's sandbox and capturing stubs
// (spec 0257 R22): the sandbox builds hermetically, a refused run touches no engine, and a GitHub
// rehearsal reaches the (scripted) rehearsal helper once per extension. It runs against the shell
// driver; the ts leg is added with the TypeScript entry.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { createReleaseSandbox } from "./lib/release-driver-sandbox.ts";

const GITHUB_REHEARSAL = {
  GITHUB_ACTIONS: "true",
  RELEASE_DRY_RUN: "true",
  GITHUB_SERVER_URL: "https://github.com",
  GITHUB_REPOSITORY: "acme/crewrig",
};

describe("release driver sandbox", () => {
  it("builds a hermetic repository with real dependencies and an isolated environment", () => {
    const sb = createReleaseSandbox();
    for (const name of ["js-yaml", "argparse"]) {
      const stat = fs.lstatSync(path.join(sb.root, "node_modules", name));
      assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), `${name} must be a real directory`);
    }
    for (const rel of [
      ".git",
      "package.json",
      "scripts/monorepo-release.sh",
      "extensions/core/hello-world/extension.json",
      "extensions/core/second-ext/extension.json",
    ]) {
      assert.ok(fs.existsSync(path.join(sb.root, rel)), `${rel} exists`);
    }
    const env = sb.env();
    assert.deepEqual(
      Object.keys(env).filter((k) => /^(CI|NODE_TEST_CONTEXT|GITHUB_|GITLAB_|CI_)/.test(k)),
      [],
    );
    assert.ok(fs.existsSync(path.join(sb.originBare, "HEAD")), "origin is a bare repository");
    assert.equal(sb.env({ GITHUB_ACTIONS: "true" })["GITHUB_ACTIONS"], "true");
    sb.dispose();
    assert.equal(fs.existsSync(sb.root), false);
  });

  it("refuses outside a CI environment without any engine call", () => {
    const sb = createReleaseSandbox();
    const res = sb.run("shell");
    assert.equal(res.status, 2);
    assert.match(res.stderr, /Error: unsupported release forge: none \(not a CI environment\)/);
    assert.deepEqual(sb.readJsonl("npx"), []);
    assert.deepEqual(sb.readJsonl("rehearse"), []);
    sb.dispose();
  });

  it("refuses the ts leg while the TypeScript driver does not exist", () => {
    const sb = createReleaseSandbox();
    if (!fs.existsSync(path.join(sb.root, "scripts", "monorepo-release.ts"))) {
      assert.throws(() => sb.run("ts"), /ts leg is not available/);
    }
    sb.dispose();
  });

  it("rehearses a GitHub run through the scripted rehearsal stub", () => {
    const sb = createReleaseSandbox();
    sb.scriptRehearse({
      "hello-world": {
        released: true,
        version: "1.3.0",
        gitTag: "hello-world-v1.3.0",
        lastTag: "hello-world-v1.2.0",
        notes: "## Notes\n- a note",
      },
      "second-ext": { released: false },
    });
    const res = sb.run("shell", GITHUB_REHEARSAL);
    assert.match(res.stdout, /REHEARSAL hello-world version=1\.3\.0 /, res.stdout + res.stderr);
    assert.match(res.stdout, /UNCHANGED second-ext/);
    const calls = sb.readJsonl("rehearse");
    assert.equal(calls.length, 2);
    for (const call of calls) {
      assert.match(String(call["configFile"]), /\.releaserc\.json$/);
      assert.equal(typeof JSON.parse(String(call["config"])), "object");
    }
    assert.deepEqual(sb.readJsonl("npx"), []);
    sb.dispose();
  });

  it("keeps the credential refusal of the real helper in the stub, naming only the variable", () => {
    const sb = createReleaseSandbox();
    const stub = path.join(sb.root, "scripts", "lib", "release-rehearse.mjs");
    const res = spawnSync(process.execPath, [stub, "main"], {
      cwd: path.join(sb.root, "extensions", "core", "hello-world"),
      env: sb.env({ GITHUB_TOKEN: "s3cr3t-value" }),
      encoding: "utf8",
    });
    assert.equal(res.status, 2);
    assert.match(res.stderr, /credential variables present: GITHUB_TOKEN/);
    assert.ok(!res.stderr.includes("s3cr3t-value"));
    assert.deepEqual(sb.readJsonl("rehearse"), []);
    sb.dispose();
  });

  it("records an npx call with both config files and prints the scripted output", () => {
    const sb = createReleaseSandbox();
    const dir = path.join(sb.root, "extensions", "core", "hello-world");
    const extra = path.join(sb.root, "extra.releaserc.json");
    fs.writeFileSync(path.join(dir, ".releaserc.json"), '{"a":1}');
    fs.writeFileSync(extra, '{"b":2}');
    sb.scriptNpx({ "hello-world": { lines: ["Created tag hello-world-v1.3.0"], status: 1 } });
    const res = spawnSync(
      "npx",
      ["semantic-release", "--branches", "main", "--extends", `semantic-release-monorepo,${extra}`],
      { cwd: dir, env: sb.env({ RELEASE_X: "1", UNRELATED: "no" }), encoding: "utf8" },
    );
    assert.equal(res.status, 1);
    assert.equal(res.stdout, "Created tag hello-world-v1.3.0\n");
    const [call] = sb.readJsonl("npx");
    assert.equal(call?.["releaserc"], '{"a":1}');
    assert.equal(call?.["extendsContent"], '{"b":2}');
    const names = Object.keys(call?.["env"] as Record<string, string>);
    assert.ok(names.includes("RELEASE_X") && !names.includes("UNRELATED"));
    sb.dispose();
  });
});

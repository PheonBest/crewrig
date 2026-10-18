// Spec 0257 R14, R18, R19: the asynchronous process layer of the release driver. A real child
// (this Node.js binary) stands in for the engine, so streaming, signals and the absence of a
// shell are observed rather than assumed.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { runRehearse, runSemanticRelease } from "../lib/monorepo-release/engine.ts";
import { killAll, spawnCapture, spawnInherit, spawnTee } from "../lib/monorepo-release/spawn.ts";

const NODE = process.execPath;
const env = { ...process.env };
const posix = process.platform !== "win32";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-process-test-"));
}

function node(script: string, ...args: string[]): string[] {
  return [NODE, "-e", script, ...args];
}

describe("spawnTee", () => {
  it("forwards both streams in arrival order and returns the merged output and status", async () => {
    const chunks: string[] = [];
    const script =
      "process.stdout.write('one\\n');" +
      "setTimeout(()=>{process.stderr.write('two\\n');" +
      "setTimeout(()=>{process.stdout.write('three\\n');process.exitCode=3},60)},60)";
    const result = await spawnTee(node(script), {
      cwd: os.tmpdir(),
      env,
      out: (chunk) => chunks.push(chunk),
    });
    assert.equal(result.status, 3);
    assert.equal(result.output, "one\ntwo\nthree\n");
    assert.equal(chunks.join(""), "one\ntwo\nthree\n");
    assert.ok(chunks.length >= 2, "the output arrived in more than one piece, not at the end");
  });

  it("appends the output to the log file", async () => {
    const dir = tmpDir();
    try {
      const logFile = path.join(dir, "engine.log");
      fs.writeFileSync(logFile, "earlier\n");
      await spawnTee(node("console.log('a'); console.error('b')"), {
        cwd: dir,
        env,
        out: () => undefined,
        logFile,
      });
      const log = fs.readFileSync(logFile, "utf8");
      assert.ok(log.startsWith("earlier\n"));
      assert.match(log, /a\n/);
      assert.match(log, /b\n/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports 127 when the program cannot be started", async () => {
    const chunks: string[] = [];
    const result = await spawnTee(["crewrig-no-such-program-xyz"], {
      cwd: os.tmpdir(),
      env,
      out: (chunk) => chunks.push(chunk),
    });
    assert.equal(result.status, 127);
    assert.match(result.output, /crewrig-no-such-program-xyz/);
  });

  it(
    "settles with 128+n when killAll terminates the child",
    { skip: !posix && "no POSIX signals" },
    async () => {
      const pending = spawnTee(node("console.log('up'); setTimeout(()=>{}, 60000)"), {
        cwd: os.tmpdir(),
        env,
        out: (chunk) => {
          if (chunk.includes("up")) killAll("SIGTERM");
        },
      });
      const result = await pending;
      assert.equal(result.status, 128 + os.constants.signals.SIGTERM);
    },
  );

  it("never uses a shell: shell syntax in an argument is passed literally", async () => {
    const hostile = ["a;echo INJECTED", "$(echo INJECTED)", "`echo INJECTED`", "x | y"];
    const result = await spawnTee(
      node("console.log(JSON.stringify(process.argv.slice(1)))", ...hostile),
      { cwd: os.tmpdir(), env, out: () => undefined },
    );
    assert.equal(result.status, 0);
    assert.deepEqual(JSON.parse(result.output), hostile);
  });
});

describe("spawnCapture", () => {
  it("returns stdout and forwards stderr as it arrives", async () => {
    const seen: string[] = [];
    const result = await spawnCapture(
      node(
        "process.stderr.write('log line\\n'); process.stdout.write('{\"ok\":true}'); process.exitCode=2",
      ),
      { cwd: os.tmpdir(), env, stderr: (chunk) => seen.push(chunk) },
    );
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '{"ok":true}');
    assert.equal(seen.join(""), "log line\n");
  });

  it("reports 127 and the reason on stderr for an unknown program", async () => {
    const seen: string[] = [];
    const result = await spawnCapture(["crewrig-no-such-program-xyz"], {
      cwd: os.tmpdir(),
      env,
      stderr: (chunk) => seen.push(chunk),
    });
    assert.equal(result.status, 127);
    assert.equal(result.stdout, "");
    assert.match(seen.join(""), /crewrig-no-such-program-xyz/);
  });

  it("runs in the given directory with exactly the given environment", async () => {
    const dir = tmpDir();
    try {
      const result = await spawnCapture(
        node(
          "process.stdout.write(process.cwd() + '|' + String(process.env.GH_TOKEN) + '|' + process.env.KEPT)",
        ),
        {
          cwd: dir,
          env: { PATH: process.env["PATH"], KEPT: "yes", GH_TOKEN: undefined },
          stderr: () => undefined,
        },
      );
      assert.equal(result.stdout, `${fs.realpathSync(dir)}|undefined|yes`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("engine", () => {
  it("runRehearse passes branch, configuration and apply, and returns the verdict JSON", async () => {
    const dir = tmpDir();
    try {
      // The helper is generated here: a tracked `.mjs` would trip the shell-and-JavaScript ratchet.
      fs.writeFileSync(
        path.join(dir, "release-rehearse.mjs"),
        "console.error('engine log'); console.log(JSON.stringify(process.argv.slice(2)));",
      );
      const logFile = path.join(dir, "rehearse.log");
      const seen: string[] = [];
      const result = await runRehearse({
        dir,
        libDir: dir,
        branch: "main",
        releasercPath: "/x/y.releaserc.json",
        apply: true,
        env,
        stderr: (chunk) => seen.push(chunk),
        logFile,
      });
      assert.equal(result.status, 0);
      assert.deepEqual(JSON.parse(result.json), ["main", "/x/y.releaserc.json", "apply"]);
      assert.equal(seen.join(""), "engine log\n");
      assert.equal(fs.readFileSync(logFile, "utf8"), "engine log\n");

      const dry = await runRehearse({
        dir,
        libDir: dir,
        branch: "main",
        releasercPath: "/x/y",
        apply: false,
        env,
        stderr: () => undefined,
      });
      assert.deepEqual(JSON.parse(dry.json), ["main", "/x/y"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it(
    "runSemanticRelease starts npx with the branch and the extends list, teeing its output",
    { skip: !posix && "uses a POSIX npx stand-in" },
    async () => {
      const dir = tmpDir();
      try {
        const bin = path.join(dir, "bin");
        fs.mkdirSync(bin);
        fs.writeFileSync(path.join(bin, "npx"), '#!/bin/sh\nprintf "%s\\n" "$@"\n', {
          mode: 0o755,
        });
        const logFile = path.join(dir, "publish.log");
        const chunks: string[] = [];
        const result = await runSemanticRelease({
          dir,
          branch: "main",
          releasercPath: "/r/ext.releaserc.json",
          env: { PATH: `${bin}${path.delimiter}${process.env["PATH"] ?? ""}` },
          logFile,
          out: (chunk) => chunks.push(chunk),
        });
        assert.equal(result.status, 0);
        const lines = result.output.trim().split("\n");
        assert.deepEqual(lines, [
          "semantic-release",
          "--branches",
          "main",
          "--extends",
          "semantic-release-monorepo,/r/ext.releaserc.json",
        ]);
        assert.equal(chunks.join(""), result.output);
        assert.equal(fs.readFileSync(logFile, "utf8"), result.output);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});

/** Poll until `file` exists, so the child is known to be running before it is signalled. */
async function waitFor(file: string): Promise<void> {
  for (let i = 0; i < 200 && !fs.existsSync(file); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.ok(fs.existsSync(file), "the child never started");
}

describe("spawnInherit", () => {
  it("resolves to the exit status of an argv child, without a shell", async () => {
    const status = await spawnInherit(
      node("process.exitCode = process.argv[1] === '$(x)' ? 5 : 9", "$(x)"),
      {
        cwd: os.tmpdir(),
        env,
      },
    );
    assert.equal(status, 5);
  });

  it("resolves to 127 for a program that cannot start", async () => {
    assert.equal(
      await spawnInherit(["crewrig-no-such-program-xyz"], { cwd: os.tmpdir(), env }),
      127,
    );
  });

  it(
    "settles with 128+n when killAll terminates an argv child",
    { skip: !posix && "no POSIX signals" },
    async () => {
      const dir = tmpDir();
      try {
        const marker = path.join(dir, "up");
        const pending = spawnInherit(
          node(
            `require('node:fs').writeFileSync(${JSON.stringify(marker)}, '');setTimeout(()=>{}, 60000)`,
          ),
          { cwd: dir, env },
        );
        await waitFor(marker);
        killAll("SIGTERM");
        assert.equal(await pending, 128 + os.constants.signals.SIGTERM);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it(
    "settles with 128+n when killAll terminates a shell command",
    { skip: !posix && "no POSIX signals" },
    async () => {
      const dir = tmpDir();
      try {
        const marker = path.join(dir, "up");
        const command = `touch "${marker}"; exec sleep 60`;
        const pending = spawnInherit(command, { cwd: dir, env });
        await waitFor(marker);
        killAll("SIGTERM");
        assert.equal(await pending, 128 + os.constants.signals.SIGTERM);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});

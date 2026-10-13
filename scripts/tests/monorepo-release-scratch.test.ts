// Spec 0257 R18, R19: the scratch directory, the signal cleanup and the `dist/` ledger.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { DistLedger, createScratch } from "../lib/monorepo-release/scratch.ts";

const LIB = path.resolve(import.meta.dirname, "../lib/monorepo-release");

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-scratch-test-"));
}

describe("createScratch", () => {
  it("creates a fresh directory under the given parent and removes it, idempotently", () => {
    const parent = tmpDir();
    try {
      const a = createScratch({ parent });
      const b = createScratch({ parent });
      assert.notEqual(a.dir, b.dir);
      assert.equal(path.dirname(a.dir), parent);
      fs.writeFileSync(path.join(a.dir, "f"), "x");
      a.dispose();
      assert.equal(fs.existsSync(a.dir), false);
      a.dispose();
      assert.equal(fs.existsSync(b.dir), true);
      b.dispose();
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });
});

describe(
  "installCleanup",
  { skip: process.platform === "win32" && "POSIX signals are not delivered on Windows" },
  () => {
    it("on SIGTERM stops the running child, removes the scratch directory and exits 143", async () => {
      const parent = tmpDir();
      const script = path.join(parent, "driver.mjs");
      const url = (file: string): string => pathToFileURL(path.join(LIB, file)).href;
      fs.writeFileSync(
        script,
        [
          `import { createScratch, installCleanup } from ${JSON.stringify(url("scratch.ts"))};`,
          `import { spawnTee } from ${JSON.stringify(url("spawn.ts"))};`,
          `const scratch = createScratch({ parent: ${JSON.stringify(parent)} });`,
          "installCleanup(scratch);",
          "console.log('SCRATCH ' + scratch.dir);",
          "const grandchild = \"console.log('PID ' + process.pid); setTimeout(() => {}, 60000)\";",
          "await spawnTee([process.execPath, '-e', grandchild], { cwd: process.cwd(), env: process.env, out: (c) => process.stdout.write(c) });",
        ].join("\n"),
      );
      const childEnv = { ...process.env };
      delete childEnv["NODE_TEST_CONTEXT"];
      delete childEnv["CI"];
      const driver = spawn(
        process.execPath,
        ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", script],
        {
          env: childEnv,
          stdio: ["ignore", "pipe", "inherit"],
        },
      );
      let seen = "";
      const ready = new Promise<{ scratch: string; pid: number }>((resolve, reject) => {
        driver.once("error", reject);
        driver.stdout.setEncoding("utf8").on("data", (chunk: string) => {
          seen += chunk;
          const scratch = /SCRATCH (.+)\n/.exec(seen);
          const pid = /PID (\d+)\n/.exec(seen);
          if (scratch?.[1] !== undefined && pid?.[1] !== undefined) {
            resolve({ scratch: scratch[1], pid: Number(pid[1]) });
          }
        });
      });
      const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
        (resolve) => {
          driver.once("close", (code, signal) => resolve({ code, signal }));
        },
      );
      try {
        const { scratch, pid } = await ready;
        assert.equal(fs.existsSync(scratch), true);
        driver.kill("SIGTERM");
        const { code, signal } = await closed;
        assert.deepEqual({ code, signal }, { code: 143, signal: null });
        assert.equal(fs.existsSync(scratch), false, "the scratch directory is gone");
        assert.throws(() => process.kill(pid, 0), { code: "ESRCH" }, "the grandchild is gone");
      } finally {
        driver.kill("SIGKILL");
        fs.rmSync(parent, { recursive: true, force: true });
      }
    });
  },
);

describe("DistLedger", () => {
  function layout(): { root: string; dist: string } {
    const root = tmpDir();
    return { root, dist: path.join(root, "dist") };
  }

  function populate(dist: string, exts: readonly string[]): void {
    for (const ext of exts) {
      fs.mkdirSync(path.join(dist, "release", ext), { recursive: true });
      fs.writeFileSync(path.join(dist, "release", ext, "a.tar.gz"), "x");
      fs.writeFileSync(path.join(dist, "release", `${ext}.releaserc.json`), "{}");
    }
  }

  it("removes the whole dist/ when it did not exist before the run", () => {
    const { root, dist } = layout();
    try {
      const ledger = new DistLedger();
      ledger.begin(dist);
      populate(dist, ["alpha", "beta"]);
      ledger.cleanup(["alpha"]);
      assert.equal(fs.existsSync(dist), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("removes only the listed extension directories, then an emptied dist/release", () => {
    const { root, dist } = layout();
    try {
      fs.mkdirSync(dist);
      fs.writeFileSync(path.join(dist, "keep.txt"), "mine");
      const ledger = new DistLedger();
      ledger.begin(dist);
      populate(dist, ["alpha", "beta"]);
      ledger.cleanup(["alpha", "beta"]);
      assert.deepEqual(fs.readdirSync(dist), ["keep.txt"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("leaves dist/release and the other extensions alone when something else remains", () => {
    const { root, dist } = layout();
    try {
      fs.mkdirSync(path.join(dist, "release", "other"), { recursive: true });
      const ledger = new DistLedger();
      ledger.begin(dist);
      populate(dist, ["alpha"]);
      ledger.cleanup(["alpha"]);
      assert.deepEqual(fs.readdirSync(path.join(dist, "release")), ["other"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("does nothing before begin", () => {
    new DistLedger().cleanup(["alpha"]);
  });
});

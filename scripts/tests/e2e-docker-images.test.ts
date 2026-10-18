// e2e-docker-images.test.ts — runtime contract of the e2e Docker images (ADR 0001, spec 0261 R19).
// Migrated from test-e2e-docker-images.sh. Needs Docker and the locally built images, so it
// skips when `docker` is absent, on win32 (Linux images, POSIX volume semantics) and per image
// when the image is not built. The compressed-size budget stays opt-in via E2E_DOCKER_TESTS_FULL=1.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import zlib from "node:zlib";

const hasDocker = spawnSync("docker", ["--version"], { stdio: "ignore" }).status === 0;
const SKIP =
  process.platform === "win32"
    ? "Linux images and POSIX mounts: not exercised on win32"
    : hasDocker
      ? false
      : "docker not installed";
const FULL = process.env.E2E_DOCKER_TESTS_FULL === "1";

const IMAGES: ReadonlyArray<readonly [string, string]> = [
  ["base", ""],
  ["claude", "claude"],
  ["gemini", "gemini"],
  ["copilot", "copilot"],
  ["mempalace", "mempalace"],
];

const run = (args: string[]) => spawnSync("docker", args, { encoding: "utf8" });
const present = (img: string): boolean => run(["image", "inspect", img]).status === 0;

/** Compressed size of `docker save`, streamed so the image is never held in memory. */
const compressedSize = (img: string): Promise<number> =>
  new Promise((resolve, reject) => {
    const save = spawn("docker", ["save", img], { stdio: ["ignore", "pipe", "ignore"] });
    const gz = zlib.createGzip();
    let size = 0;
    gz.on("data", (c: Buffer) => (size += c.length));
    gz.on("end", () => resolve(size));
    save.on("error", reject);
    save.stdout.pipe(gz);
  });

describe("e2e Docker images", { skip: SKIP }, () => {
  for (const [short, cli] of IMAGES) {
    const img = `crewrig/e2e-${short}:latest`;
    const built = hasDocker && process.platform !== "win32" && present(img);
    const skip = built ? false : `${img} not built locally: run \`task e2e:build\``;

    it(`${img} runs as agent uid/gid 1000 in /home/agent/workspace`, { skip }, () => {
      const id = run(["run", "--rm", "--entrypoint", "id", img]).stdout;
      assert.ok(id.includes("uid=1000(agent)") && id.includes("gid=1000(agent)"), id);
      assert.equal(
        run(["run", "--rm", "--entrypoint", "pwd", img]).stdout.trim(),
        "/home/agent/workspace",
      );
    });

    it(`${img} PATH contains /usr/sbin and /sbin`, { skip }, () => {
      const out = run([
        "run",
        "--rm",
        "--entrypoint",
        "bash",
        img,
        "-c",
        'echo "$PATH"',
      ]).stdout.trim();
      assert.ok(`:${out}:`.includes(":/usr/sbin:") && `:${out}:`.includes(":/sbin:"), out);
    });

    if (short === "base") {
      it(`${img} mount points are owned by agent`, { skip }, () => {
        const out = run([
          "run",
          "--rm",
          "--entrypoint",
          "stat",
          img,
          "-c",
          "%U",
          "/home/agent/.claude",
          "/home/agent/.gemini",
          "/home/agent/.copilot",
          "/home/agent/.mempalace",
        ]).stdout;
        assert.equal(out.split("\n").filter((l) => l === "agent").length, 4, out);
      });
    }

    if (cli !== "") {
      it(`${img} ${cli} --version exits 0 with non-empty output`, { skip }, () => {
        const r = run(["run", "--rm", img, cli, "--version"]);
        assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
        assert.notEqual(r.stdout.trim(), "");
      });
    }

    it(
      `${img} compressed size within the ADR budget`,
      { skip: skip || (FULL ? false : "set E2E_DOCKER_TESTS_FULL=1 to run") },
      async () => {
        const budget = (short === "base" ? 500 : 800) * 1024 * 1024;
        const size = await compressedSize(img);
        assert.ok(size <= budget, `got ${size} B, budget ${budget} B`);
      },
    );
  }
});

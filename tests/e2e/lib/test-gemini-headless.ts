// test-gemini-headless.ts — TypeScript twin of test-gemini-headless.sh (spec 0261 R1-R4, R24):
// a standalone TAP smoke test of the post-#148 headless contract. Skips with `1..0 # SKIP` (exit 78)
// when docker, the image or the gemini auth bundle is missing; otherwise runs `docker run` of
// `gemini -p` for at most 60 s.

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { findOnPath, runTool } from "./exec.ts";

type Env = Readonly<Record<string, string>>;

const BOOTSTRAP =
  'set -e; D=/home/agent/.gemini; mkdir -p $D && cp -a /run/gemini-creds/. $D/ && chown -R agent:agent $D 2>/dev/null || true; exec gemini "$@"';
const PROMPT = "Write the single word READY to /out/answer.txt and print it.";

function out(text: string | Buffer): void {
  process.stdout.write(text);
}

function nonEmpty(file: string): boolean {
  try {
    return fs.statSync(file).size > 0;
  } catch {
    return false;
  }
}

export function main(env: Env): number {
  const image = env["GEMINI_IMAGE"] || "crewrig/e2e-gemini:latest";
  const geminiDir = `${env["CREWRIG_E2E_HOME"] || `${env["HOME"] ?? ""}/.crewrig-e2e`}/gemini`;
  const cwd = process.cwd();
  if (findOnPath("docker", env) === null) {
    out("1..0 # SKIP docker not found on PATH\n");
    return 78;
  }
  if (runTool("docker", ["image", "inspect", image], { cwd, env }).rc !== 0) {
    out(`1..0 # SKIP image ${image} not present locally\n`);
    return 78;
  }
  const isFile = (f: string) => fs.existsSync(f) && fs.statSync(f).isFile();
  if (!isFile(`${geminiDir}/settings.json`) || !isFile(`${geminiDir}/oauth_creds.json`)) {
    out(
      `1..0 # SKIP gemini auth bundle not found at ${geminiDir} (run \`task e2e:auth:gemini\`)\n`,
    );
    return 78;
  }
  const rand = crypto.randomBytes(8).toString("base64url").replace(/[-_]/g, "x").slice(0, 10);
  const work = path.join(os.tmpdir(), `tmp.${rand}`);
  fs.mkdirSync(work, { mode: 0o700 });
  try {
    const stdoutFd = fs.openSync(path.join(work, "stdout.txt"), "w");
    const stderrFd = fs.openSync(path.join(work, "stderr.txt"), "w");
    const exe = findOnPath("docker", env) ?? "docker";
    const res = spawnSync(
      exe,
      [
        "run",
        "--rm",
        "--stop-timeout",
        "5",
        "-v",
        `${geminiDir}:/run/gemini-creds:ro`,
        "-v",
        `${work}:/out`,
        "--entrypoint",
        "bash",
        image,
        "-c",
        BOOTSTRAP,
        "sh",
        "-p",
        PROMPT,
      ],
      { cwd, env: { ...env }, stdio: ["ignore", stdoutFd, stderrFd], timeout: 60_000 },
    );
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);
    const exit =
      res.error !== undefined && res.signal === null
        ? 127
        : res.signal === null
          ? (res.status ?? 1)
          : 143;
    const exitOk = exit === 0 || exit === 124;
    let source = "none";
    if (nonEmpty(path.join(work, "answer.txt"))) source = "/out/answer.txt";
    else if (nonEmpty(path.join(work, "stdout.txt")))
      source = "stdout (fallback — model did not honour the side-effect ask)";
    if (exitOk && source !== "none") {
      out(`ok 1 - headless: gemini -p exited ${exit} with non-empty answer from ${source}\n`);
    } else {
      const err = fs.readFileSync(path.join(work, "stderr.txt")).subarray(0, 200);
      const tail = Buffer.from(
        err.toString("latin1").replace(/\0/g, "").replace(/\n+$/, ""),
        "latin1",
      );
      out(
        Buffer.concat([
          Buffer.from(`not ok 1 - headless: exit=${exit} answer=${source}; stderr: `),
          tail,
          Buffer.from("\n"),
        ]),
      );
      out("1..1\n");
      return 1;
    }
    out("1..1\n");
    return 0;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
  );
  process.exitCode = main(env);
}

// mcp-daemon-rig.ts — shared rig of the mcp-daemon-*.test.ts suites (spec 0263,
// port of scripts/tests/test-mcp-daemon.sh). POSIX use only: it drives the Bash
// library `scripts/lib/common.sh` and the Bash launcher.
// Retires with scripts/lib/common.sh (row J4).
//
// ISOLATION CONTRACT (inherited from the Bash suite): every test that touches
// supervisor or daemon state isolates on label/unit, PORT and HOME, and refuses
// to run when one resolves to its production value (`assertIsolated`).
//
// API (keep stable, other suites import it):
//   makeRig(): Promise<Rig>      scratch rig; call `rig.cleanup()` in `after`.
//   Rig fields: home (real path), claudeConfigDir, label, unit, port (a free
//     loopback port), launcherPath, stubDir, realHome, realPort, and `env`, the
//     full child environment (HOME and USERPROFILE = home, CLAUDE_CONFIG_DIR,
//     MEMPALACE_MCP_LABEL/UNIT/PORT/LAUNCHER_PATH/PYTHON,
//     MEMPALACE_MCP_CHROMA_WAIT=2, MEMPALACE_CHROMA_PORT=1 (a dead port),
//     CREWRIG_TEST_SERVICE_BIN_DIR=stubDir).
//   rig.assertIsolated()         throws when an axis is a production value.
//   rig.runCommon(body, extra?)  `bash -c 'source common.sh; <body>'`, returns
//     Result {status, signal, stdout, stderr}; `extra` overrides env entries
//     (undefined deletes one). CREWRIG_REPO_DIR is set to the repository.
//   rig.runLauncherBounded(script, boundMs?, extra?)  runs `bash <script>`,
//     stdout+stderr combined into `output`, killed (SIGKILL) at the bound;
//     returns {status, signal, output, elapsedMs, timedOut}. Default 20 000 ms.
//   rig.tokenPath()              `mcp_token_path` for the current env.
//   rig.writeToken(text)         write the token file (parents created), 0600.
//   rig.installLauncher()        `install_mcp_launcher`, returns the installed path.
//   startFakeMcp(port, code)     in-process node:http fake MCP server; resolves
//     once listening: GET /healthz 200 "ok", other GET 404, POST answers `code`
//     with `{}`. Returns {close(), port}.
//   stubBin(dir, names?)         no-op executables (default claude gemini copilot agy).
//   modeOf(file)                 permission bits, e.g. 0o600.
//   freePort()                   a free loopback port.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { cleanEnv, realTmp, REPO, type Result, which } from "./worktree-fixtures.ts";

export const PROD_LABEL = "com.mempalace.mcp-server";
export const PROD_UNIT = "mempalace-mcp-server";
export const PROD_PORTS: readonly string[] = ["8021", "41893"];
const BASH = which("bash") ?? "/bin/bash";

export interface LauncherRun {
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly output: string;
  readonly elapsedMs: number;
  readonly timedOut: boolean;
}

export interface FakeMcp {
  readonly port: number;
  close(): Promise<void>;
}

export interface Rig {
  readonly home: string;
  readonly claudeConfigDir: string;
  readonly label: string;
  readonly unit: string;
  readonly port: number;
  readonly launcherPath: string;
  readonly stubDir: string;
  readonly realHome: string;
  readonly realPort: string;
  readonly env: NodeJS.ProcessEnv;
  assertIsolated(): void;
  runCommon(body: string, extra?: Record<string, string | undefined>): Result;
  runLauncherBounded(
    script: string,
    boundMs?: number,
    extra?: Record<string, string | undefined>,
  ): Promise<LauncherRun>;
  tokenPath(extra?: Record<string, string | undefined>): string;
  writeToken(text: string): string;
  installLauncher(): string;
  cleanup(): void;
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

export function modeOf(file: string): number {
  return fs.statSync(file).mode & 0o777;
}

/** Write no-op `#!/bin/sh` executables, one per name. */
export function stubBin(
  dir: string,
  names: readonly string[] = ["claude", "gemini", "copilot", "agy"],
): void {
  fs.mkdirSync(dir, { recursive: true });
  for (const name of names) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, "#!/bin/sh\nexit 0\n");
    fs.chmodSync(file, 0o755);
  }
}

export function startFakeMcp(port: number, code: number): Promise<FakeMcp> {
  const server = http.createServer((req, res) => {
    if (req.method === "GET") {
      const ok = req.url === "/healthz";
      res.writeHead(ok ? 200 : 404);
      res.end(ok ? "ok" : "");
      return;
    }
    req.resume();
    req.on("end", () => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      resolve({
        port,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

function withExtra(
  base: NodeJS.ProcessEnv,
  extra: Record<string, string | undefined>,
): NodeJS.ProcessEnv {
  const env = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

export async function makeRig(): Promise<Rig> {
  const realHome = process.env["HOME"] ?? "";
  const realPort = process.env["MEMPALACE_MCP_PORT"] ?? "";
  const home = realTmp("crewrig-mcp-daemon-");
  const stubDir = path.join(home, "stub-bin");
  const claudeConfigDir = path.join(home, ".claude-config");
  fs.mkdirSync(claudeConfigDir, { recursive: true });
  stubBin(stubDir);
  const port = await freePort();
  const suffix = `${process.pid}-${Math.floor(Math.random() * 1e6)}`;
  const label = `${PROD_LABEL}-test-${suffix}`;
  const unit = `${PROD_UNIT}-test-${suffix}`;
  const launcherPath = path.join(home, ".crewrig", "mcp-daemon-launcher.sh");
  const python = process.env["MEMPALACE_PYTHON"] ?? which("python3") ?? "/usr/bin/python3";
  const env = cleanEnv({
    HOME: home,
    USERPROFILE: home,
    CLAUDE_CONFIG_DIR: claudeConfigDir,
    MEMPALACE_MCP_LABEL: label,
    MEMPALACE_MCP_UNIT: unit,
    MEMPALACE_MCP_PORT: String(port),
    MEMPALACE_MCP_LAUNCHER_PATH: launcherPath,
    MEMPALACE_PYTHON: python,
    MEMPALACE_MCP_CHROMA_WAIT: "2",
    MEMPALACE_CHROMA_PORT: "1",
    CREWRIG_TEST_SERVICE_BIN_DIR: stubDir,
    MEMPALACE_PALACE_PATH: undefined,
  });

  const runCommon = (body: string, extra: Record<string, string | undefined> = {}): Result => {
    const script = [
      "set +e",
      `source ${JSON.stringify(path.join(REPO, "scripts", "lib", "common.sh"))}`,
      `CREWRIG_REPO_DIR=${JSON.stringify(REPO)}`,
      body,
    ].join("\n");
    const res = spawnSync(BASH, ["-c", script], {
      encoding: "utf8",
      cwd: home,
      env: withExtra(env, extra),
    });
    return { status: res.status, signal: res.signal, stdout: res.stdout, stderr: res.stderr };
  };

  const rig: Rig = {
    home,
    claudeConfigDir,
    label,
    unit,
    port,
    launcherPath,
    stubDir,
    realHome,
    realPort,
    env,
    assertIsolated(): void {
      const resolved = fs.realpathSync.native(home);
      const bad =
        label === PROD_LABEL ||
        unit === PROD_UNIT ||
        PROD_PORTS.includes(String(port)) ||
        (realPort !== "" && String(port) === realPort) ||
        home === realHome ||
        env["HOME"] !== home ||
        env["USERPROFILE"] !== home ||
        !resolved.startsWith(fs.realpathSync.native(os.tmpdir()));
      if (bad)
        throw new Error(
          `REFUSING TO RUN: an isolation axis is a production value (label=${label} unit=${unit} port=${port} home=${home})`,
        );
    },
    runCommon,
    runLauncherBounded(script, boundMs = 20_000, extra = {}): Promise<LauncherRun> {
      return new Promise((resolve) => {
        const started = Date.now();
        const child = spawn(BASH, [script], {
          env: withExtra(env, extra),
          cwd: home,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let output = "";
        let timedOut = false;
        child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
        child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
        const timer = setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, boundMs);
        child.on("close", (status, signal) => {
          clearTimeout(timer);
          resolve({ status, signal, output, elapsedMs: Date.now() - started, timedOut });
        });
      });
    },
    tokenPath(extra = {}): string {
      return runCommon("mcp_token_path", extra).stdout.trim();
    },
    writeToken(text: string): string {
      const file = rig.tokenPath();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text, { mode: 0o600 });
      return file;
    },
    installLauncher(): string {
      const res = runCommon("install_mcp_launcher >/dev/null 2>&1; mcp_launcher_installed_path");
      return res.stdout.trim();
    },
    cleanup(): void {
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
  return rig;
}

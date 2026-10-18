// mcp-daemon-rig.ts — shared rig of the mcp-daemon status suite (spec 0263, spec 0266 slice 5).
// The Bash library and launcher it once drove are gone; the launcher is installed through the
// TypeScript installer (`installLauncherProgram`).
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
//   rig.installLauncher()        installs the TypeScript launcher program and record; returns the record path.
//   startFakeMcp(port, code)     in-process node:http fake MCP server; resolves
//     once listening: GET /healthz 200 "ok", other GET 404, POST answers `code`
//     with `{}`. Returns {close(), port}.
//   stubBin(dir, names?)         no-op executables (default claude gemini copilot agy).
//   modeOf(file)                 permission bits, e.g. 0o600.
//   freePort()                   a free loopback port.

import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { installedPaths, installLauncherProgram } from "../../lib/service/program-install.ts";
import { cleanEnv, realTmp, REPO, which } from "./worktree-fixtures.ts";

export const PROD_LABEL = "com.mempalace.mcp-server";
export const PROD_UNIT = "mempalace-mcp-server";
export const PROD_PORTS: readonly string[] = ["8021", "41893"];

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
    installLauncher(): string {
      const paths = installedPaths(home, env);
      installLauncherProgram({
        paths,
        repoDir: REPO,
        host: "127.0.0.1",
        port: String(port),
        chromaHost: "127.0.0.1",
        chromaPort: "1",
        python,
        palacePath: "",
      });
      return paths.record;
    },
    cleanup(): void {
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
  return rig;
}

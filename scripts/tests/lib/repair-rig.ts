// repair-rig.ts — the scratch HOME shared by the repair and token-rotation
// tests (spec 0263): a real-path HOME and USERPROFILE, the four assistant stubs
// on PATH (`command -v` is the "present" gate), CLAUDE_CONFIG_DIR pointed at the
// scratch directory, and a runner for `bash scripts/repair-mempalace-http.sh`.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const REPO = path.resolve(import.meta.dirname, "..", "..", "..");
export const RESIDUE = '{"mcpServers":{"mempalace":{"nonsense":true}}}\n';
export const usable = (arg: string): string =>
  `{"mcpServers":{"mempalace":{"command":"bash","args":["${arg}"]}}}\n`;
export const TOKEN_CFG = (token: string): string =>
  `{"mcpServers":{"mempalace":{"type":"http","url":"http://127.0.0.1:1/mcp","headers":{"Authorization":"Bearer ${token}"}}}}\n`;

export interface Rig {
  home: string;
  bin: string;
  gemini: string;
  env: NodeJS.ProcessEnv;
}

export interface Run {
  status: number | null;
  out: string;
  err: string;
}

/** A scratch HOME under `root` with the assistants stubbed on PATH. */
export function makeRig(root: string, name: string, stubs: string[]): Rig {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(root, `${name}-`)));
  const bin = path.join(home, "bin");
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(home, ".gemini"), { recursive: true });
  // node by symlink, not its directory: that directory may hold a real assistant CLI.
  fs.symlinkSync(process.execPath, path.join(bin, "node"));
  for (const tool of stubs)
    fs.writeFileSync(path.join(bin, tool), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const env: NodeJS.ProcessEnv = {
    HOME: home,
    USERPROFILE: home,
    CLAUDE_CONFIG_DIR: path.join(home, ".claude"),
    PATH: `${bin}${path.delimiter}/usr/bin${path.delimiter}/bin`,
    CREWRIG_TEST_MOCK_DAEMON: "true",
  };
  return { home, bin, gemini: path.join(home, ".gemini", "settings.json"), env };
}

/** The scratch root: a real path, removed by the caller. */
export const scratchRoot = (prefix: string): string =>
  fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));

/** `bash scripts/repair-mempalace-http.sh <args>` under an optional umask. */
export function runRepair(rig: Rig, args: string[] = [], umask = "022"): Run {
  const r = spawnSync(
    "bash",
    [
      "-c",
      'umask "$1"; shift; exec bash scripts/repair-mempalace-http.sh "$@"',
      "repair",
      umask,
      ...args,
    ],
    { cwd: REPO, env: rig.env, encoding: "utf8", timeout: 30_000 },
  );
  return { status: r.status, out: r.stdout, err: r.stderr };
}

/** Permission bits in octal as `stat -c %a` prints them (leading zeros stripped). */
export const modeOf = (file: string): string => (fs.statSync(file).mode & 0o7777).toString(8);

/** Same, without following a link. */
export const lmodeOf = (file: string): string => (fs.lstatSync(file).mode & 0o7777).toString(8);

const tool = (cmd: string, args: string[]): boolean =>
  spawnSync(cmd, args, { stdio: "ignore" }).status === 0;

/**
 * Make `file` report `want` while the owner can still read it. macOS: an ACL
 * grants the owner read. Linux: a named ACL on the owner is inert, so a foreign
 * owner with group read is used (`sudo -n`). Returns null on success, else the
 * reason this platform cannot build the fixture (the caller skips with it).
 */
export function ownerUnreadable(file: string, want: string): string | null {
  const me = os.userInfo().username;
  if (tool("chmod", [want, file]) && modeOf(file) === parseInt(want, 8).toString(8)) {
    const acl =
      tool("chmod", ["+a", `user:${me} allow read`, file]) ||
      tool("setfacl", ["-m", `u:${me}:r`, file]);
    if (acl && canRead(file) && modeOf(file) === parseInt(want, 8).toString(8)) return null;
  }
  if (tool("sudo", ["-n", "true"])) {
    const group = String(process.getgid?.() ?? 0);
    const keep = want === "100" ? "140" : want;
    const foreign = ["nobody", "daemon", "root", "bin", "sys"].find((u) => tool("id", [u]));
    if (
      foreign &&
      tool("sudo", ["-n", "chown", `${foreign}:${group}`, file]) &&
      tool("sudo", ["-n", "chmod", keep, file]) &&
      canRead(file)
    )
      return null;
  }
  return `no way to build a readable file reporting mode ${want} here (no ACL primitive, no passwordless sudo)`;
}

function canRead(file: string): boolean {
  try {
    fs.readFileSync(file);
    return true;
  } catch {
    return false;
  }
}

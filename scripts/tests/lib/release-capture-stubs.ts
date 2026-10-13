// release-capture-stubs.ts — the capturing stand-ins the release driver black-box suite puts
// around the driver (spec 0257 R22). Every stub is written at RUNTIME into the sandbox, from the
// string constants below, so the repository tracks no `.js`/`.mjs`/`#!` file for them (ratchet).
//
// Each stub records one JSON line per call into `$CAPTURE_DIR/<name>.jsonl`, with the environment
// restricted to the names a release engine could read a forge, a git identity or a credential
// from: that is what the suite asserts on. What a stub PRINTS is scripted per extension (the
// directory name of its cwd) in `$CAPTURE_DIR/<name>-script.json`:
//   npx-script.json      { "<ext>": ["line", ...] | { "lines": [...], "status": 1 } }
//   rehearse-script.json { "<ext>": { released, version, gitTag, lastTag, notes,
//                                      prepare?: boolean, exit?: number } }
// Shared by the shell driver and the TypeScript one: both reach the same two engine entry points
// (`npx semantic-release` and `scripts/lib/release-rehearse.mjs`), so one set of stubs serves
// both legs of the suite.

import fs from "node:fs";
import path from "node:path";

/** The release core's own credential-name rule, plus the GitLab job-token URL (release lib). */
export const CREDENTIAL_NAME = /token|password|credential|secret|private/i;

/** The variables a stub records: forge, identity, release control, or credential-named. */
const RECORDED = "^(GIT_|CI_|GITHUB_|GITLAB_|RELEASE_)";

/** True when `name` is a credential-named variable (the rule above, CI_REPOSITORY_URL included). */
export function isCredentialName(name: string): boolean {
  return CREDENTIAL_NAME.test(name) || name === "CI_REPOSITORY_URL";
}

/** Shared prologue: the capture directory, the JSON-line recorder and the env filter. */
const PROLOGUE = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const capture = process.env.CAPTURE_DIR;
if (!capture) { process.stderr.write("CAPTURE_DIR is not set\n"); process.exit(97); }
const RECORDED = new RegExp(${JSON.stringify(RECORDED)});
const CRED = /token|password|credential|secret|private/i;
function read(file) { try { return fs.readFileSync(file, "utf8"); } catch { return null; } }
function readScript(name) {
  const text = read(path.join(capture, name + "-script.json"));
  return text === null ? {} : JSON.parse(text);
}
function recordedEnv() {
  const out = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (RECORDED.test(key) || CRED.test(key)) out[key] = value;
  }
  return out;
}
function record(name, entry) {
  fs.appendFileSync(path.join(capture, name + ".jsonl"), JSON.stringify(entry) + "\n");
}
`;

/** `npx semantic-release ...`: records the call and the two config files it would load. */
const NPX = String.raw`#!/usr/bin/env node
"use strict";
${PROLOGUE}
const argv = process.argv.slice(2);
const cwd = process.cwd();
const ext = path.basename(cwd);
// --extends semantic-release-monorepo,<file>: the file is read NOW, the driver deletes it later.
const at = argv.indexOf("--extends");
const spec = at === -1 ? "" : String(argv[at + 1] ?? "");
const comma = spec.indexOf(",");
const extendsFile = comma === -1 ? null : spec.slice(comma + 1);
record("npx", {
  argv, cwd, ext,
  releaserc: read(path.join(cwd, ".releaserc.json")),
  extendsFile,
  extendsContent: extendsFile === null ? null : read(extendsFile),
  env: recordedEnv(),
});
const scripted = readScript("npx")[ext];
const lines = Array.isArray(scripted) ? scripted : (scripted && scripted.lines) || [];
const status = Array.isArray(scripted) || !scripted ? 0 : Number(scripted.status || 0);
if (lines.length > 0) process.stdout.write(lines.join("\n") + "\n");
process.exitCode = status;
`;

/** `gh ...`: records its argv and succeeds; the suite has no network and no real forge CLI. */
const GH = String.raw`#!/usr/bin/env node
"use strict";
${PROLOGUE}
record("gh", { argv: process.argv.slice(2), cwd: process.cwd(), env: recordedEnv() });
`;

/**
 * The replacement of scripts/lib/release-rehearse.mjs: same CLI, same one-line JSON on stdout,
 * same refusal (exit 2, names only) on a credential-named variable. With `prepare: true` in the
 * script entry it also runs the config's exec plugin `prepareCmd` for real, so the manifest sync
 * and the packaging the real engine would trigger happen in the sandbox.
 */
const REHEARSE = String.raw`import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
${PROLOGUE}
const present = Object.keys(process.env)
  .filter((name) => CRED.test(name) || name === "CI_REPOSITORY_URL")
  .sort();
if (present.length > 0) {
  process.stderr.write("release-rehearse: refusing to run with credential variables present: " + present.join(", ") + "\n");
  process.exit(2);
}
const argv = process.argv.slice(2);
const cwd = process.cwd();
const ext = path.basename(cwd);
const configFile = argv[1];
const config = configFile ? read(configFile) : null;
record("rehearse", { argv, cwd, ext, configFile: configFile ?? null, config, env: recordedEnv() });

const scripted = readScript("rehearse")[ext] ?? { released: false };
if (scripted.exit) {
  process.stderr.write("release-rehearse: the release engine failed: scripted failure\n");
  process.exit(scripted.exit);
}
if (scripted.released && scripted.prepare && config !== null) {
  const PLACEHOLDER = "$" + "{nextRelease.version}";
  const exec = (JSON.parse(config).plugins ?? []).find((p) => Array.isArray(p) && p[0] === "@semantic-release/exec");
  const cmd = exec ? String(exec[1].prepareCmd).split(PLACEHOLDER).join(scripted.version) : "";
  if (cmd !== "") {
    const win = process.platform === "win32";
    const res = win
      ? spawnSync("cmd.exe", ["/d", "/s", "/c", cmd], { cwd, stdio: ["ignore", 2, 2], windowsVerbatimArguments: true })
      : spawnSync("sh", ["-c", cmd], { cwd, stdio: ["ignore", 2, 2] });
    if (res.status !== 0) process.exit(1);
  }
}
const released = Boolean(scripted.released);
process.stdout.write(JSON.stringify({
  released,
  version: released ? scripted.version ?? null : null,
  gitTag: released ? scripted.gitTag ?? null : null,
  lastTag: scripted.lastTag ?? null,
  notes: released ? scripted.notes ?? null : null,
}) + "\n");
`;

const WINDOWS_WRAPPER = (name: string): string =>
  `@echo off\r\nnode "%~dp0${name}.stub" %*\r\nexit /b %errorlevel%\r\n`;

/** One POSIX stub (extensionless, `#!/usr/bin/env node`, 0o755) and, for Windows, its `.cmd`. */
function writeBinStub(binDir: string, name: string, source: string): void {
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, name), source, { mode: 0o755 });
  fs.chmodSync(path.join(binDir, name), 0o755);
  // `node <file>` needs no shebang: the `.cmd` points at a copy that keeps the same source.
  fs.writeFileSync(path.join(binDir, `${name}.stub`), source);
  fs.writeFileSync(path.join(binDir, `${name}.cmd`), WINDOWS_WRAPPER(name));
}

/** Install `npx` and `gh` into `binDir`, which the caller puts first on PATH. */
export function installBinStubs(binDir: string): void {
  writeBinStub(binDir, "npx", NPX);
  writeBinStub(binDir, "gh", GH);
}

/**
 * Replace the sandbox copy of the rehearsal helper. Only the sandbox file is touched: the stub is
 * the file the driver runs, and the real one in the repository stays what it is.
 */
export function installRehearseStub(sandboxRoot: string): string {
  const file = path.join(sandboxRoot, "scripts", "lib", "release-rehearse.mjs");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, REHEARSE);
  return file;
}

/** Script what `npx` prints, per extension directory name. */
export type NpxScript = Record<
  string,
  readonly string[] | { lines: readonly string[]; status: number }
>;

/** What the rehearse stub reports, per extension directory name. */
export interface RehearseEntry {
  readonly released: boolean;
  readonly version?: string;
  readonly gitTag?: string;
  readonly lastTag?: string | null;
  readonly notes?: string;
  /** Run the config's exec `prepareCmd` for real (manifest sync + packaging). */
  readonly prepare?: boolean;
  /** Fail like an engine error with this exit status instead of reporting. */
  readonly exit?: number;
}
export type RehearseScript = Record<string, RehearseEntry>;

export function writeScript(captureDir: string, name: "npx" | "rehearse", script: object): void {
  fs.mkdirSync(captureDir, { recursive: true });
  fs.writeFileSync(path.join(captureDir, `${name}-script.json`), JSON.stringify(script));
}

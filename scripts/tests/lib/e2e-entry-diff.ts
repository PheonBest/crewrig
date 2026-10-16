// e2e-entry-diff.ts — run one end-to-end ENTRY (an auth script, the publisher, the capture script, a
// probe) through its shell leg and its TypeScript leg in the same kind of sandbox and describe what
// it did, so a differential test can require the same tuple from both (spec 0261 R10).
//
// Sandbox: scratch HOME, CREWRIG_E2E_HOME, TMPDIR and working directory; the Docker stand-in first
// on PATH (plus optional stub tools written at test time); `LC_ALL=C`; CI and NODE_TEST_CONTEXT never
// reach the child. The tuple holds the exit status, both streams, every text file under the
// sandbox's work/home trees with its mode, and the stand-in's call log, all normalised.
// POSIX only. Nothing here reaches a container engine, an account or the real HOME.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { writeLauncher, type FixtureEntry } from "./e2e-docker-standin.ts";
import { REPO_ROOT, normalise, normaliseArgv } from "./e2e-normalise.ts";
import { findTool } from "./hermetic-env.ts";

export type Leg = "shell" | "entry";

export interface EntryBox {
  readonly root: string;
  readonly work: string;
  readonly home: string;
  readonly e2eHome: string;
  readonly bin: string;
}

export interface EntryCase {
  readonly id: string;
  /** Repository-relative path without extension, e.g. `scripts/e2e/auth-claude`. */
  readonly file: string;
  readonly args?: readonly string[];
  /** Extra environment; `{WORK}`, `{HOME}` and `{E2E_HOME}` are replaced. */
  readonly env?: Readonly<Record<string, string>>;
  readonly seed?: (box: EntryBox) => void;
  readonly fixtures?: readonly FixtureEntry[];
  readonly forbidRun?: boolean;
  readonly missingImages?: readonly string[];
  readonly stdin?: string;
  /** Tool name -> text of an executable stub written into the scratch bin dir. */
  readonly stubTools?: Readonly<Record<string, string>>;
}

export interface EntryTuple {
  readonly id: string;
  readonly rc: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly files: Readonly<Record<string, { readonly content: string; readonly mode: string }>>;
  readonly dockerCalls: readonly (readonly string[])[];
}

const NODE_FLAG = "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON";

/** A skip reason when the shell leg cannot run on this host, else null. */
export function shellLegPrerequisites(): string | null {
  if (process.platform === "win32") return "the shell leg needs a POSIX host";
  const bash = findTool("bash");
  if (bash === undefined) return "bash is missing";
  const v = spawnSync(bash, ["-c", "printf %s ${BASH_VERSINFO[0]}"], { encoding: "utf8" });
  return Number(v.stdout) >= 4 ? null : `bash >= 4 is required (found ${v.stdout || "unknown"})`;
}

export function entryExists(c: EntryCase, leg: Leg): boolean {
  return fs.existsSync(path.join(REPO_ROOT, `${c.file}.${leg === "shell" ? "sh" : "ts"}`));
}

function walk(dir: string, base: string, out: Record<string, { content: string; mode: string }>) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else if (entry.isFile()) {
      const buf = fs.readFileSync(full);
      if (buf.includes(0)) continue;
      const mode = (fs.statSync(full).mode & 0o777).toString(8).padStart(4, "0");
      out[path.relative(base, full).split(path.sep).join("/")] = {
        content: buf.toString("latin1"),
        mode,
      };
    }
  }
}

export function runEntry(c: EntryCase, leg: Leg): EntryTuple | null {
  if (!entryExists(c, leg)) return null;
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "e2e-entry-")));
  const box: EntryBox = {
    root,
    work: path.join(root, "work"),
    home: path.join(root, "home"),
    e2eHome: path.join(root, "home", ".crewrig-e2e"),
    bin: path.join(root, "bin"),
  };
  for (const d of [box.work, box.home, box.bin, path.join(root, "tmp"), path.join(root, "state")]) {
    fs.mkdirSync(d, { recursive: true });
  }
  writeLauncher(box.bin);
  for (const [tool, text] of Object.entries(c.stubTools ?? {})) {
    fs.writeFileSync(path.join(box.bin, tool), text, { mode: 0o755 });
  }
  const fixtureFile = path.join(root, "fixtures.json");
  fs.writeFileSync(fixtureFile, JSON.stringify({ [c.id]: c.fixtures ?? [] }));
  const log = path.join(root, "docker.jsonl");
  const env: Record<string, string> = {
    PATH: `${box.bin}${path.delimiter}${process.env["PATH"] ?? ""}`,
    HOME: box.home,
    USERPROFILE: box.home,
    TMPDIR: path.join(root, "tmp"),
    LC_ALL: "C",
    CREWRIG_E2E_HOME: box.e2eHome,
    E2E_STANDIN_FIXTURES: fixtureFile,
    E2E_STANDIN_CASE: c.id,
    E2E_STANDIN_STATE: path.join(root, "state"),
    E2E_STANDIN_LOG: log,
    ...(c.forbidRun === true ? { E2E_STANDIN_FORBID_RUN: "1" } : {}),
    ...(c.missingImages !== undefined
      ? { E2E_STANDIN_MISSING_IMAGES: c.missingImages.join(",") }
      : {}),
  };
  for (const [k, v] of Object.entries(c.env ?? {})) {
    env[k] = v
      .split("{WORK}")
      .join(box.work)
      .split("{HOME}")
      .join(box.home)
      .split("{E2E_HOME}")
      .join(box.e2eHome);
  }
  c.seed?.(box);
  const file = path.join(REPO_ROOT, `${c.file}.${leg === "shell" ? "sh" : "ts"}`);
  const [cmd, argv] =
    leg === "shell"
      ? [findTool("bash") ?? "bash", [file, ...(c.args ?? [])]]
      : [process.execPath, [NODE_FLAG, file, ...(c.args ?? [])]];
  const res = spawnSync(cmd, argv, {
    cwd: box.work,
    env,
    input: c.stdin ?? "",
    encoding: "latin1",
  });
  const files: Record<string, { content: string; mode: string }> = {};
  walk(box.work, box.work, files);
  const homeFiles: Record<string, { content: string; mode: string }> = {};
  walk(box.home, box.home, homeFiles);
  for (const [k, v] of Object.entries(homeFiles)) files[`~/${k}`] = v;
  const ctx = { tmp: root, home: box.home, e2eHome: box.e2eHome };
  const fixed = (s: string) => normalise(s, ctx);
  const calls: string[][] = fs.existsSync(log)
    ? fs
        .readFileSync(log, "utf8")
        .split("\n")
        .filter((l) => l !== "")
        .map((l) => (JSON.parse(l) as { argv: string[] }).argv)
    : [];
  const tuple: EntryTuple = {
    id: c.id,
    rc: res.status ?? -1,
    stdout: fixed(res.stdout),
    stderr: fixed(res.stderr),
    files: Object.fromEntries(
      Object.entries(files).map(([k, v]) => [k, { content: fixed(v.content), mode: v.mode }]),
    ),
    dockerCalls: calls.map((a) => normaliseArgv(a, ctx)),
  };
  fs.rmSync(root, { recursive: true, force: true });
  return tuple;
}

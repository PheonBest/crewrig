// packaging-release-observe.ts — run one packaging or documentation entry as a black box and
// describe what it did (spec 0257 R24, R25): status, both streams and every file it wrote.
//
// Everything is held as byte-faithful `latin1` strings: an invalid UTF-8 page must stay visible
// as the bytes the shell copied, not as the U+FFFD a decode would make of it. Archives are read
// through `tar-reader.ts` and compared by their decompressed entries, never by their header fields.

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

import { createFixtureTree } from "./build-fixture-tree.ts";
import type { FixtureTree } from "./build-fixture-tree.ts";
import { placeholder } from "./golden-normalize.ts";
import { readTarGz } from "./tar-reader.ts";
import { baseEnv, makeSandbox, toolPath } from "./release-sandbox.ts";

export type Leg = "shell" | "ts";
export type Kind = "docs" | "packaging" | "sync";

export interface ArchiveEntry {
  readonly path: string;
  readonly type: "file" | "dir";
  /** Only what a reader of the extracted tree sees: executable or not. */
  readonly modeClass: "dir" | "exec" | "file";
  readonly sha256: string;
}

export type FileObs =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "binary"; readonly sha256: string }
  | {
      readonly kind: "archive";
      readonly entries: readonly ArchiveEntry[];
      /** The entry paths in archive order: ordering is deviation (e). */
      readonly order: readonly string[];
      readonly stream: string;
      readonly bytes: string;
    };

export interface Observed {
  status: number;
  stdout: string;
  stderr: string;
  files: Record<string, FileObs>;
}

export interface DiffCase {
  /** Golden directory name. */
  readonly name: string;
  readonly kind: Kind;
  /** The entry without extension: `scripts/<script>.sh` and `scripts/<script>.ts`. */
  readonly script: string;
  readonly args: (version: string) => readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly setup?: (box: FixtureTree, version: string) => void;
  /** Unobserved invocations run first, in the same sandbox and with the same environment. */
  readonly before?: readonly (readonly string[])[];
  /** False when no shell oracle exists (golden only). */
  readonly oracle?: boolean;
  /** Working directory relative to the sandbox root; the root itself when absent. */
  readonly cwd?: string;
}

const TOOLS = [
  "bash",
  "node",
  "jq",
  "tar",
  "dirname",
  "basename",
  "find",
  "wc",
  "tr",
  "mkdir",
  "paste",
  "cat",
  "rm",
];
const SKIPPED = new Set(["scripts", "node_modules", ".git", "extension-skeleton"]);

export const HAS_SHELL_TOOLS =
  process.platform !== "win32" &&
  ["bash", "jq", "tar"].every((cmd) => spawnSync(cmd, ["--version"]).error === undefined);

const sha = (data: Uint8Array | string): string =>
  crypto.createHash("sha256").update(data).digest("hex");

interface Names {
  readonly root: string;
  readonly version: string;
}

/** Replace what varies between runs: sandbox root, temp dirs, the Node path, versions, timestamps. */
export function normalise(text: string, names: Names): string {
  const tmp = fs.realpathSync.native(os.tmpdir());
  let out = placeholder(text, {
    main: "\0main",
    wt: "\0wt",
    common: "\0common",
    extra: { ROOT: names.root, TMP: tmp, NODE: process.execPath },
  });
  // The wording of a JSON.parse failure belongs to the Node.js version, not to the entry.
  out = out.replace(/(cannot read \S+): .*/g, "$1: <REASON>");
  if (names.version !== "") out = out.replaceAll(names.version, "<VERSION>");
  return out;
}

function observeFile(file: string, names: Names): FileObs {
  const bytes = fs.readFileSync(file);
  if (file.endsWith(".tar.gz")) {
    const records = readTarGz(file).map((r) => ({
      ...r,
      rel: r.path.replace(/^\.\//, "").replace(/\/$/, ""),
    }));
    const kept = records.filter((r) => r.rel !== "" && r.rel !== ".");
    const entries: ArchiveEntry[] = kept
      .map((r) => ({
        path: r.rel,
        type: r.type,
        modeClass:
          r.type === "dir"
            ? ("dir" as const)
            : r.mode & 0o111
              ? ("exec" as const)
              : ("file" as const),
        sha256: r.type === "dir" ? "" : contentHash(r.data, names),
      }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const stream = zlib.gunzipSync(bytes).toString("latin1");
    return {
      kind: "archive",
      entries,
      order: kept.map((r) => r.rel),
      stream: sha(names.version === "" ? stream : stream.replaceAll(names.version, "<VERSION>")),
      bytes: sha(bytes),
    };
  }
  if (bytes.includes(0)) return { kind: "binary", sha256: sha(bytes) };
  return { kind: "text", text: normalise(bytes.toString("latin1"), names) };
}

function contentHash(data: Buffer, names: Names): string {
  return data.includes(0) ? sha(data) : sha(normalise(data.toString("latin1"), names));
}

/** Every file of the sandbox outside the copied tooling: `rel -> bytes hash`, for before/after. */
function snapshot(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string, rel: string): void => {
    for (const name of fs.readdirSync(dir).sort()) {
      if (rel === "" && SKIPPED.has(name)) continue;
      const at = rel === "" ? name : `${rel}/${name}`;
      const abs = path.join(dir, name);
      if (fs.lstatSync(abs).isDirectory()) walk(abs, at);
      else out.set(at, sha(fs.readFileSync(abs)));
    }
  };
  walk(root, "");
  return out;
}

export function makeBox(testCase: DiffCase): { box: FixtureTree; version: string } {
  if (testCase.kind === "packaging") {
    const box = makeSandbox();
    return { box, version: box.version };
  }
  return { box: createFixtureTree({ deps: "none" }), version: "" };
}

function environment(testCase: DiffCase): NodeJS.ProcessEnv {
  const pathValue = testCase.kind === "packaging" ? toolPath(TOOLS) : (process.env.PATH ?? "");
  const env: NodeJS.ProcessEnv = { ...baseEnv(pathValue), LC_ALL: "C" };
  for (const name of ["EXT", "INCLUDE_ORG", "REPO_DIR", "GEMINI_CLI_HOME"]) delete env[name];
  return { ...env, ...testCase.env };
}

function invoke(
  leg: Leg,
  box: FixtureTree,
  testCase: DiffCase,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
) {
  const cwd = path.join(box.root, testCase.cwd ?? "");
  const file = (ext: string): string =>
    path.relative(cwd, path.join(box.root, "scripts", `${testCase.script}.${ext}`));
  const [cmd, flags, entry] =
    leg === "shell"
      ? ["bash", [], file("sh")]
      : [process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON"], file("ts")];
  // bsdtar on macOS archives AppleDouble `._*` files unless told not to: host noise, not a script difference.
  const legEnv = leg === "shell" ? { ...env, COPYFILE_DISABLE: "1" } : env;
  return spawnSync(cmd, [...flags, entry, ...args], { cwd, env: legEnv, encoding: "buffer" });
}

/** One leg of one case in a fresh sandbox. */
export function observe(leg: Leg, testCase: DiffCase): Observed {
  const { box, version } = makeBox(testCase);
  const names = { root: box.root, version };
  testCase.setup?.(box, version);
  const env = environment(testCase);
  for (const step of testCase.before ?? []) invoke(leg, box, testCase, step, env);
  const before = snapshot(box.root);
  const res = invoke(leg, box, testCase, testCase.args(version), env);
  const files: Record<string, FileObs> = {};
  for (const [rel, hash] of snapshot(box.root)) {
    if (before.get(rel) === hash) continue;
    files[normalise(rel, names)] = observeFile(box.resolve(rel), names);
  }
  const result = {
    status: res.status ?? -1,
    stdout: normalise(res.stdout.toString("latin1"), names),
    stderr: normalise(res.stderr.toString("latin1"), names),
    files,
  };
  box.dispose();
  return result;
}

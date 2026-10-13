// release-sandbox.ts — a throwaway repository root the release packager can run in, and the
// helpers its suites share (spec 0257 R9, R10). The root is a build-fixture-tree (a copy of
// `scripts/`, so the real builder runs, with `.git`, the root `package.json` and real `js-yaml`
// and `argparse` copies) plus `extension-skeleton/` and `extensions/`. The packager is run through
// a child Node.js process that imports the sandbox's own copy of `release-package-main.ts`, so the
// builder's inherited streams and the packager's own lines land in captured streams.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";
import { pathToFileURL } from "node:url";

import { readTarGz } from "./tar-reader.ts";
import { createFixtureTree, REPO } from "./build-fixture-tree.ts";
import type { FixtureTree } from "./build-fixture-tree.ts";

export { REPO };

/** The extension the sandbox carries. */
export const NAME = "hello-world";

export interface Sandbox extends FixtureTree {
  /** Name and version of the extension the sandbox carries. */
  readonly version: string;
}

/** A sandbox holding the committed `hello-world` extension, plus the skeleton the builder reads. */
export function makeSandbox(): Sandbox {
  const tree = createFixtureTree();
  fs.cpSync(path.join(REPO, "extension-skeleton"), tree.resolve("extension-skeleton"), {
    recursive: true,
  });
  // Only what git tracks: an installed `node_modules` or a built `dist` of an extension directory is
  // host state (workspace installs put one there), and would end up in every build tree and archive.
  fs.cpSync(path.join(REPO, "extensions"), tree.resolve("extensions"), {
    recursive: true,
    filter: (src) => !/(^|[\\/])(node_modules|dist)$/.test(src),
  });
  const manifest = JSON.parse(tree.read("extensions/core/hello-world/extension.json")) as {
    version: string;
  };
  return Object.assign(tree, { version: manifest.version });
}

const DRIVER = `
const { main } = await import(process.env.DRIVER_MAIN);
const write = (stream, text) => void stream.write(text);
process.exitCode = await main({
  argv: JSON.parse(process.env.DRIVER_ARGS),
  env: process.env,
  platform: process.platform,
  entryFile: process.env.DRIVER_ENTRY,
  io: {
    out: (line) => write(process.stdout, line + "\\n"),
    err: (line) => write(process.stderr, line + "\\n"),
    errRaw: (text) => write(process.stderr, text),
  },
});
`;

export interface Run {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** The packaging mains a sandbox can run, with the entry file each one is handed. */
const ENTRIES = {
  "release-package": ["release-package-main.ts", "release-package-extension.ts"],
  "package-one": ["package-one-main.ts", "package-extension.ts"],
  "package-all": ["package-all-main.ts", "package-extensions.ts"],
} as const;
export type EntryName = keyof typeof ENTRIES;

/** One packaging main of the sandbox, run in a child process with the sandbox as cwd. */
export function runEntry(
  sandbox: FixtureTree,
  entry: EntryName,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Run {
  const root = sandbox.root;
  const [mainFile, entryFile] = ENTRIES[entry];
  const res = spawnSync(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--input-type=module", "-e", DRIVER],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...env,
        DRIVER_ARGS: JSON.stringify(args),
        DRIVER_MAIN: pathToFileURL(path.join(root, "scripts", "lib", "packaging", mainFile)).href,
        DRIVER_ENTRY: path.join(root, "scripts", entryFile),
      },
    },
  );
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

/** `release-package-main.ts` of the sandbox. */
export function runPackager(
  sandbox: FixtureTree,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Run {
  return runEntry(sandbox, "release-package", args, env);
}

const owned: string[] = [];
after(() => {
  for (const dir of owned) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  owned.push(dir);
  return dir;
}

/** The environment of a run: the host's, minus what would leak the outer test run into it. */
export function baseEnv(pathValue: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: pathValue };
  delete env.NODE_TEST_CONTEXT;
  delete env.CI;
  return env;
}

/** A `PATH` value naming a directory with nothing in it: no `gemini` can be found there. */
export function emptyPath(): string {
  return tempDir("release-empty-path-");
}

/**
 * A directory with a fake `gemini` and a `node` it can run under. The fake appends its arguments
 * to `$FAKE_GEMINI_LOG`, writes to both streams (a discarded stream must not reach the packager's),
 * and exits with `$FAKE_GEMINI_EXIT`. On Windows it is a `.cmd` shim around the same script.
 */
export function fakeGeminiPath(): { readonly dir: string; readonly log: string } {
  const dir = tempDir("release-fake-gemini-");
  const script = path.join(dir, "gemini-fake.js");
  fs.writeFileSync(
    script,
    [
      'const fs = require("node:fs");',
      'fs.appendFileSync(process.env.FAKE_GEMINI_LOG, process.argv.slice(2).join(" ") + "\\n");',
      'process.stdout.write("FAKE-GEMINI-STDOUT\\n");',
      'process.stderr.write("FAKE-GEMINI-STDERR\\n");',
      'process.exitCode = Number(process.env.FAKE_GEMINI_EXIT ?? "0");',
      "",
    ].join("\n"),
  );
  if (process.platform === "win32") {
    fs.writeFileSync(
      path.join(dir, "gemini.cmd"),
      `@echo off\r\n"${process.execPath}" "%~dp0gemini-fake.js" %*\r\n`,
    );
  } else {
    fs.symlinkSync(process.execPath, path.join(dir, "node"));
    const shim = path.join(dir, "gemini");
    fs.writeFileSync(shim, `#!/usr/bin/env node\nrequire(${JSON.stringify(script)});\n`);
    fs.chmodSync(shim, 0o755);
  }
  return { dir, log: path.join(dir, "gemini.log") };
}

/**
 * A `PATH` directory of symlinks to the real tools the shell oracle needs, so a `gemini` the host
 * happens to have is never reached. Tools are located by scanning the host's `PATH`.
 */
export function toolPath(tools: readonly string[]): string {
  const dir = tempDir("release-tools-");
  const hostDirs = (process.env.PATH ?? "").split(path.delimiter).filter((d) => d !== "");
  for (const tool of tools) {
    const real =
      tool === "node"
        ? process.execPath
        : hostDirs.map((d) => path.join(d, tool)).find((p) => fs.existsSync(p));
    if (real !== undefined) fs.symlinkSync(real, path.join(dir, tool));
  }
  return dir;
}

/** Every file and directory of a tree: `{ "a/b": "<content hex>" | "<dir>" }`, keys sorted. */
export function treeOfDir(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const visit = (dir: string, rel: string): void => {
    for (const name of fs.readdirSync(dir).sort()) {
      const abs = path.join(dir, name);
      const at = rel === "" ? name : `${rel}/${name}`;
      if (fs.lstatSync(abs).isDirectory()) {
        out[at] = "<dir>";
        visit(abs, at);
      } else {
        out[at] = fs.readFileSync(abs).toString("hex");
      }
    }
  };
  visit(root, "");
  return out;
}

/** The same map for an archive, root entry (`./`) left out: what extracting it would produce. */
export function treeOfArchive(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const record of readTarGz(file)) {
    const rel = record.path.replace(/^\.\//, "").replace(/\/$/, "");
    if (rel === "" || rel === ".") continue;
    out[rel] = record.type === "dir" ? "<dir>" : record.data.toString("hex");
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** A stub builder: refuses the named extensions, builds every other one with the real builder. */
export function stubBuilder(sandbox: Sandbox, failing: readonly string[]): void {
  fs.renameSync(
    sandbox.resolve("scripts/build-extension.ts"),
    sandbox.resolve("scripts/build-extension-real.ts"),
  );
  sandbox.write(
    "scripts/build-extension.ts",
    [
      `if (${JSON.stringify(failing)}.includes(process.argv[4])) process.exitCode = 1;`,
      'else require("./build-extension-real.ts");',
      "",
    ].join("\n"),
  );
}

/** `extensions/<tier>/<name>` as a copy of the committed extension; the builder names its output by manifest. */
export function addExtension(sandbox: Sandbox, tier: string, name: string): void {
  const dest = `extensions/${tier}/${name}`;
  fs.cpSync(sandbox.resolve(`extensions/core/${NAME}`), sandbox.resolve(dest), { recursive: true });
  const manifest = JSON.parse(sandbox.read(`${dest}/extension.json`)) as Record<string, unknown>;
  sandbox.write(`${dest}/extension.json`, JSON.stringify({ ...manifest, name }));
}

export function twoPerTier(sandbox: Sandbox): void {
  addExtension(sandbox, "core", "zz-core");
  addExtension(sandbox, "library", "aa-lib");
  addExtension(sandbox, "library", "ab-lib");
  addExtension(sandbox, "org", "org-ext");
}

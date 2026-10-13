// package-one-main.ts — `package-extension`: package one extension's own committed version (spec
// 0257 R12). Replaced the shell script of the same name (scripts/package-extension.sh, now a forwarding shim): the extension comes from `EXT`, its version from
// its `extension.json`, and the release lands in `dist/release/<EXT>/`, emptied first. The shell
// script delegated to release-package-extension.sh; this calls the packager in process.

import fs from "node:fs";
import path from "node:path";

import { repoDirOf } from "../extension/entry-ctx.ts";
import type { EntryInput } from "../extension/entry-ctx.ts";
import { readJsonFile } from "../extension/descriptors.ts";
import { extVersion } from "../extension/manifest.ts";
import { ExtError } from "../extension/types.ts";
import { releasePackage } from "./release-package.ts";
import { packageNotFound, resolveExtensionDir } from "./tiers.ts";

/** What `jq -r '.version // ""' <file>` leaves the shell: a version, or the exit status it died with. */
type VersionRead =
  | { readonly ok: true; readonly version: string }
  | { readonly ok: false; readonly status: number };

/**
 * The shell ran `VERSION="$(jq ... 2>/dev/null)"` under `set -e`, so a manifest jq could not use
 * ended the script silently with jq's own status: 2 for a file it cannot read, 5 for one it can
 * read but not index (invalid JSON or a non-object value). A JSON `null` has no version, which
 * is the empty-version message.
 */
function readVersion(manifestPath: string): VersionRead {
  try {
    fs.readFileSync(manifestPath);
  } catch {
    return { ok: false, status: 2 };
  }
  let doc;
  try {
    doc = readJsonFile(manifestPath);
  } catch (error) {
    if (error instanceof ExtError) return { ok: false, status: 5 };
    throw error;
  }
  if (doc === null) return { ok: true, version: "" };
  if (!(doc instanceof Map)) return { ok: false, status: 5 };
  return { ok: true, version: extVersion(doc) };
}

/** `rm -rf <repoDir>/dist/release/<ext>`, refused for a name that would climb out of `dist/release`. */
function clearOutDir(repoDir: string, outDir: string): void {
  const root = path.resolve(repoDir, "dist", "release");
  const rel = path.relative(root, path.resolve(outDir));
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new ExtError(`refusing to remove '${outDir}': it is not inside ${root}`);
  }
  fs.rmSync(outDir, { recursive: true, force: true });
}

/** Run `package-extension`; returns its exit status. */
export async function main(input: EntryInput): Promise<number> {
  const { env, io } = input;
  const ext = env.EXT ?? "";
  if (ext === "") {
    // The shell's plain `echo`: this one line goes to stdout.
    io.out("Error: EXT variable is required (e.g., EXT=hello-world).");
    return 1;
  }
  const repoDir = repoDirOf(input.entryFile);
  try {
    const extDir = resolveExtensionDir(repoDir, ext, packageNotFound);
    const manifestPath = `${extDir}/extension.json`;
    const read = readVersion(manifestPath);
    if (!read.ok) return read.status;
    if (read.version === "") {
      io.err(`Error: ${manifestPath} carries no .version.`);
      return 1;
    }
    const outDir = `${repoDir}/dist/release/${ext}`;
    clearOutDir(repoDir, outDir);
    return await releasePackage({
      repoDir,
      name: ext,
      version: read.version,
      outDir,
      env,
      platform: input.platform,
      io,
    });
  } catch (error) {
    if (error instanceof ExtError) {
      io.err(`Error: ${error.message}`);
      return error.status;
    }
    throw error;
  }
}

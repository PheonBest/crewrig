// release-package.ts — the one place a versioned release artifact's shape is decided (spec 0183
// R17/R21/R22; ported by spec 0257 R9, R10, decision D1). Replaced
// the body of the former scripts/release-package-extension.ts: the five assertions in the shell's order with its messages
// and its stdout lines, then the archive.
//
// The fresh render is a SPAWNED `node scripts/build-extension.ts --target gemini <name>` with
// inherited streams, not an in-process call: a sandbox can replace that one file to prove the
// packager refuses a tree that does not build, as the shell's stub of build-extension.ts did.
// Nothing here exits the process; the caller gets the exit status.

import fs from "node:fs";
import path from "node:path";

import { extBuildDir, extVersion, readManifest } from "../extension/manifest.ts";
import { assertCurrentShape } from "../extension/shape-guard.ts";
import { ExtError } from "../extension/types.ts";
import type { Io } from "../extension/types.ts";
import { onPath, runDiscard, runInherit } from "./spawn-sync.ts";
import { ArchiveError, writeArchive } from "./tar-writer.ts";
import { resolveExtensionDir } from "./tiers.ts";

export interface ReleasePackageOptions {
  readonly repoDir: string;
  readonly name: string;
  readonly version: string;
  readonly outDir: string;
  readonly env: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
  readonly io: Io;
}

/** Regular files directly under `dir` (`find -mindepth 1 -maxdepth 1 -type f`: links are not files). */
function countFiles(dir: string): number {
  return fs.readdirSync(dir).filter((entry) => fs.lstatSync(path.join(dir, entry)).isFile()).length;
}

/** Assertion 1: the manifest is in the current declaration shape; the error lines, none when it is. */
function shapeErrors(repoDir: string, extDir: string): string[] {
  const manifestPath = `${extDir}/extension.json`;
  if (!fs.existsSync(manifestPath) || !fs.statSync(manifestPath).isFile()) {
    return [
      `Error: no extension.json found in ${extDir} — run scripts/migrate-extension.ts if this is an old-shape extension.`,
    ];
  }
  try {
    return assertCurrentShape(manifestPath, readManifest(manifestPath), `${repoDir}/scripts/lib`);
  } catch (error) {
    // The shell's `jq -e` guards fail silently on an unreadable manifest; the render that follows
    // is what refuses it, with the builder's own diagnostic.
    if (error instanceof ExtError) return [];
    throw error;
  }
}

/** The built manifest's `.version // ""`; an unreadable manifest has no version to match. */
function builtVersion(builtManifest: string): string {
  try {
    return extVersion(readManifest(builtManifest));
  } catch (error) {
    if (error instanceof ExtError) return "";
    throw error;
  }
}

/** Run the packager; returns the exit status (0 on success, 1 on the first failed assertion). */
export async function releasePackage(opts: ReleasePackageOptions): Promise<number> {
  const { repoDir, name, version, outDir, env, io } = opts;
  const platform = opts.platform ?? process.platform;
  try {
    const extDir = resolveExtensionDir(repoDir, name);

    const shape = shapeErrors(repoDir, extDir);
    if (shape.length > 0) {
      for (const line of shape) io.err(line);
      return 1;
    }

    const cwd = process.cwd();
    const builder = [
      process.execPath,
      `${repoDir}/scripts/build-extension.ts`,
      "--target",
      "gemini",
      name,
    ];
    if (runInherit(builder, { cwd, env, platform }) !== 0) {
      io.err(
        `Error: a fresh --target gemini render failed for '${name}' — refusing to publish a release artifact for a tree that does not build.`,
      );
      return 1;
    }

    const buildDir = extBuildDir(repoDir, name);
    const builtManifest = `${buildDir}/gemini-extension.json`;
    if (!fs.existsSync(builtManifest) || !fs.statSync(builtManifest).isFile()) {
      io.err(
        `Error: ${buildDir} carries no gemini-extension.json at its root — a source-only tree is not a publishable release artifact (spec 0183 R17).`,
      );
      return 1;
    }

    const built = builtVersion(builtManifest);
    if (built !== version) {
      io.err(
        `Error: ${builtManifest} declares version '${built}', which does not equal the requested release version '${version}' (spec 0183 R22).`,
      );
      return 1;
    }

    fs.mkdirSync(outDir, { recursive: true });
    const existing = countFiles(outDir);
    if (existing > 0) {
      io.err(
        `Error: ${outDir} already carries ${existing} file(s) — a release publishes exactly ONE asset (the installed tool resolves the generic asset only when the release carries exactly one; a checksums file or a second archive defeats it just as a second archive would). Clear ${outDir} before packaging.`,
      );
      return 1;
    }

    if (onPath("gemini", env, platform)) {
      const validate = ["gemini", "extensions", "validate", buildDir];
      if (runDiscard(validate, { cwd, env, platform, allowSpaces: true }) === 0) {
        io.out("  gemini extensions validate: OK");
      } else {
        io.err(
          `  gemini extensions validate: reported an issue (non-fatal, best-effort only) — re-run manually against ${buildDir} for detail.`,
        );
      }
    } else {
      io.out(
        "  gemini CLI not on PATH — skipping the best-effort 'gemini extensions validate' check.",
      );
    }

    // The archive root is the build directory's CONTENTS, no wrapper directory: the installed tool
    // looks for gemini-extension.json directly at the root (the R20 probe,
    // docs/runbooks/extension-release-install-probe.md).
    const archive = `${outDir}/${name}-${version}.tar.gz`;
    writeArchive(buildDir, archive, { platform });

    io.out(`Packaged: ${archive}`);
    io.out(
      `  Archive root: build/extensions/${name}'s CONTENTS, no wrapper directory (byte-for-byte — Ruling A, single-tool; see the R20 probe runbook for why no wrapper)`,
    );
    io.out(`  Version: ${version}`);
    return 0;
  } catch (error) {
    if (error instanceof ExtError || error instanceof ArchiveError) {
      io.err(`Error: ${error.message}`);
      return 1;
    }
    throw error;
  }
}

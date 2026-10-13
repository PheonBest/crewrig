// tiers.ts — the three extension source tiers and the lookup of one extension over them (spec 0257
// R9). Twin of the `for tier in core library org` loops of scripts/release-package-extension.sh
// and scripts/package-extension.sh; the two shell texts differ only in the not-found line, so the
// caller passes its own.

import fs from "node:fs";

import { ExtError } from "../extension/types.ts";

/** The source tiers, in lookup order. */
export const TIERS = ["core", "library", "org"] as const;
export type Tier = (typeof TIERS)[number];

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** The not-found texts of the two shell tools, without the `Error: ` prefix the caller adds. */
export const releaseNotFound = (name: string): string =>
  `extension '${name}' not found in extensions/.`;
export const packageNotFound = (name: string): string => `extension '${name}' not found.`;

/**
 * `<repoDir>/extensions/<tier>/<name>` for the one tier that holds it. A name present in two
 * tiers is refused; a name in none throws `notFound(name)`.
 */
export function resolveExtensionDir(
  repoDir: string,
  name: string,
  notFound: (name: string) => string = releaseNotFound,
): string {
  let found = "";
  for (const tier of TIERS) {
    const candidate = `${repoDir}/extensions/${tier}/${name}`;
    if (!isDir(candidate)) continue;
    if (found !== "") {
      throw new ExtError(`extension '${name}' exists in multiple tiers; names must be unique.`);
    }
    found = candidate;
  }
  if (found === "") throw new ExtError(notFound(name));
  return found;
}

/**
 * The directories directly under `extensions/<tier>/`, names in UTF-8 byte order, hidden names
 * skipped as the shell's `*` glob skips them. A missing tier lists nothing.
 */
export function listTier(repoDir: string, tier: Tier): string[] {
  const tierDir = `${repoDir}/extensions/${tier}`;
  if (!isDir(tierDir)) return [];
  return fs
    .readdirSync(tierDir)
    .filter((name) => !name.startsWith(".") && isDir(`${tierDir}/${name}`))
    .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
}

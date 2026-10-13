// extension-dirs.ts — the extension directories a flow walks: the shell's `extensions/*/*/` glob
// (a directory two levels below `extensions/`, in byte order) and the sorted `*.tar.gz` of an
// output directory (`ls "$out"/*.tar.gz | head -n 1`).

import fs from "node:fs";
import path from "node:path";

function sortedDirs(parent: string): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(parent);
  } catch {
    return [];
  }
  return names
    .filter((name) => {
      // The shell glob `*/` never matches a name that starts with a dot.
      if (name.startsWith(".")) return false;
      try {
        return fs.statSync(path.join(parent, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}

/** Every `<base>/extensions/<group>/<name>` directory, as absolute paths in byte order. */
export function extensionDirs(base: string): string[] {
  const top = path.join(base, "extensions");
  return sortedDirs(top).flatMap((group) =>
    sortedDirs(path.join(top, group)).map((name) => path.join(top, group, name)),
  );
}

/** The first `*.tar.gz` of `dir` in name order, or `undefined` when there is none. */
export function firstArchive(dir: string): string | undefined {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return undefined;
  }
  const first = names.filter((name) => name.endsWith(".tar.gz")).sort()[0];
  return first === undefined ? undefined : path.join(dir, first);
}

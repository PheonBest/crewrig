// walk.ts — `find <root> -type f` semantics in TypeScript (spec 0259).
//
// Usage: const files = findFiles(root, (rel) => rel.endsWith(".sh"));
// Regular files only: entries are lstat-ed, symlinks (even to files) and
// directories are excluded, and symlinks are never followed. Paths are relative
// to `root`, `/`-separated, sorted bytewise by UTF-16 code unit (the default
// `Array.prototype.sort` order, not locale collation).
// Exit codes: not applicable (library); an unreadable directory throws.
// Finding-line format: not applicable.

import { lstatSync, readdirSync } from "node:fs";
import path from "node:path";

/** Every regular file under `root` whose relative path satisfies `predicate`. */
export function findFiles(
  root: string,
  predicate: (rel: string) => boolean = () => true,
): string[] {
  const out: string[] = [];
  const visit = (dirRel: string): void => {
    const dirAbs = dirRel === "" ? root : path.join(root, dirRel);
    for (const name of readdirSync(dirAbs)) {
      const rel = dirRel === "" ? name : `${dirRel}/${name}`;
      const st = lstatSync(path.join(root, rel));
      if (st.isDirectory()) visit(rel);
      else if (st.isFile() && predicate(rel)) out.push(rel);
    }
  };
  visit("");
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

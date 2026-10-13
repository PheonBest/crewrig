// tree-walk.ts — deterministic directory walk for the release archive (spec 0257 R11).
//
// Names, order and modes are a pure function of the tree: the entries come back in byte order of
// their archive path, spelled the way `tar -czf out -C <root> .` spells them, with the mode
// normalised to 0755 or 0644. Anything that is not a regular file or a directory is refused, which
// also keeps the writer from ever creating or following a link.

import fs from "node:fs";
import path from "node:path";

export type TreeEntry = {
  /** Archive path: `./` for the root, `./<rel>` for files, `./<rel>/` for directories. */
  path: string;
  type: "file" | "dir";
  mode: number;
  /** Absolute path on disk, used to read the content of a file. */
  abs: string;
};

export type WalkOptions = { platform?: NodeJS.Platform };

export class ArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchiveError";
  }
}

const EXEC_BITS = 0o111;

/** True when the file starts with `#!`; the only exec signal a platform without mode bits has. */
function startsWithShebang(file: string): boolean {
  const fd = fs.openSync(file, "r");
  try {
    const head = Buffer.alloc(2);
    const read = fs.readSync(fd, head, 0, 2, 0);
    return read === 2 && head[0] === 0x23 && head[1] === 0x21;
  } finally {
    fs.closeSync(fd);
  }
}

function fileMode(abs: string, mode: number, platform: NodeJS.Platform): number {
  if ((mode & EXEC_BITS) !== 0) return 0o755;
  if (platform === "win32" && startsWithShebang(abs)) return 0o755;
  return 0o644;
}

function visit(dir: string, rel: string, platform: NodeJS.Platform, out: TreeEntry[]): void {
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const relPath = rel === "" ? name : `${rel}/${name}`;
    const stat = fs.lstatSync(abs);
    if (stat.isDirectory()) {
      out.push({ path: `./${relPath}/`, type: "dir", mode: 0o755, abs });
      visit(abs, relPath, platform, out);
    } else if (stat.isFile()) {
      out.push({
        path: `./${relPath}`,
        type: "file",
        mode: fileMode(abs, stat.mode, platform),
        abs,
      });
    } else {
      throw new ArchiveError(`cannot archive '${relPath}': not a regular file or directory`);
    }
  }
}

/** List `root` and everything below it in byte order of the archive path, the root first. */
export function walkTree(root: string, opts: WalkOptions = {}): TreeEntry[] {
  const platform = opts.platform ?? process.platform;
  const entries: TreeEntry[] = [{ path: "./", type: "dir", mode: 0o755, abs: root }];
  visit(root, "", platform, entries);
  // Compare UTF-8 bytes, not UTF-16 code units: `<` would order astral characters differently.
  return entries.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
}

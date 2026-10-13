// tar-writer.ts — deterministic `.tar.gz` writer for the extension release archive (spec 0257
// R10, R11, decision D1).
//
// Node ships no tar encoder, so the ustar stream is built here: fixed time, zero owner, normalised
// modes (tar-header.ts) and a gzip header whose time is zero and whose OS byte is the Unix value
// whatever platform runs it. The decompressed stream is therefore a pure function of the tree.

import fs from "node:fs";
import zlib from "node:zlib";
import { BLOCK, entryHeader, pad } from "./tar-header.ts";
import { walkTree } from "./tree-walk.ts";
import type { TreeEntry, WalkOptions } from "./tree-walk.ts";

export { ArchiveError, walkTree } from "./tree-walk.ts";
export type { TreeEntry } from "./tree-walk.ts";

/** Uncompressed ustar stream: each entry's header and padded content, then two zero blocks. */
export function buildTar(entries: readonly TreeEntry[]): Buffer {
  const parts: Buffer[] = [];
  entries.forEach((entry, index) => {
    const data = entry.type === "file" ? fs.readFileSync(entry.abs) : Buffer.alloc(0);
    parts.push(entryHeader(entry.path, entry.type, entry.mode, data.length, index));
    if (data.length > 0) parts.push(pad(data));
  });
  parts.push(Buffer.alloc(BLOCK * 2));
  return Buffer.concat(parts);
}

/** Gzip at level 6, then pin the header's time (bytes 4..7) to zero and its OS byte (9) to Unix. */
export function gzipTar(tar: Buffer): Buffer {
  const gz = zlib.gzipSync(tar, { level: 6 });
  gz.fill(0, 4, 8);
  gz[9] = 3;
  return gz;
}

/** Walk `root`, then write its archive to `archiveFile`; nothing is written when the walk fails. */
export function writeArchive(root: string, archiveFile: string, opts: WalkOptions = {}): void {
  const gz = gzipTar(buildTar(walkTree(root, opts)));
  fs.writeFileSync(archiveFile, gz);
}

// tar-header.ts — ustar and PAX header blocks for the deterministic archive writer (spec 0257 R11).
//
// Every field that could carry the host (time, owner, group) is a constant, so a header is a pure
// function of the entry. A path that does not fit the ustar name (100 bytes) and prefix (155 bytes)
// fields, or that is not ASCII, travels in a PAX `path` record placed before the entry.

import { ArchiveError } from "./tree-walk.ts";

export const BLOCK = 512;
/** 2000-01-01T00:00:00Z, the same fixed time for every entry and PAX header. */
export const FIXED_MTIME = 946684800;

const NAME_MAX = 100;
const PREFIX_MAX = 155;
const SIZE_MAX = 0o77777777777;

type HeaderFields = {
  name: string;
  prefix: string;
  mode: number;
  size: number;
  typeflag: "0" | "5" | "x";
};

function putString(block: Buffer, text: string, offset: number, length: number): void {
  block.write(text, offset, length, "latin1");
}

/** Octal number, zero-padded to `width - 1` digits and NUL-terminated. */
function putOctal(block: Buffer, value: number, offset: number, width: number): void {
  putString(block, `${value.toString(8).padStart(width - 1, "0")}\0`, offset, width);
}

function buildBlock(f: HeaderFields): Buffer {
  const block = Buffer.alloc(BLOCK);
  putString(block, f.name, 0, NAME_MAX);
  putOctal(block, f.mode, 100, 8);
  putOctal(block, 0, 108, 8); // uid
  putOctal(block, 0, 116, 8); // gid
  putOctal(block, f.size, 124, 12);
  putOctal(block, FIXED_MTIME, 136, 12);
  block.fill(0x20, 148, 156); // checksum counts its own field as spaces
  putString(block, f.typeflag, 156, 1);
  putString(block, "ustar\0", 257, 6);
  putString(block, "00", 263, 2);
  putString(block, f.prefix, 345, PREFIX_MAX);
  let sum = 0;
  for (const byte of block) sum += byte;
  putString(block, `${sum.toString(8).padStart(6, "0")}\0 `, 148, 8);
  return block;
}

/** Split a path at a `/` so name and prefix both fit, or return null when no split works. */
function splitPath(p: string): { name: string; prefix: string } | null {
  if (!/^[\x20-\x7e]*$/.test(p)) return null;
  if (p.length <= NAME_MAX) return { name: p, prefix: "" };
  for (let i = p.indexOf("/"); i !== -1; i = p.indexOf("/", i + 1)) {
    // A trailing slash stays on the name, as GNU tar writes a directory.
    const prefix = p.slice(0, i);
    const name = p.slice(i + 1);
    if (name !== "" && name.length <= NAME_MAX && prefix.length <= PREFIX_MAX) {
      return { name, prefix };
    }
  }
  return null;
}

function paxRecord(key: string, value: string): Buffer {
  const body = ` ${key}=${value}\n`;
  const bodyLen = Buffer.byteLength(body);
  // The decimal length counts its own digits, so settle it by iteration.
  let len = bodyLen + 1;
  while (String(len).length + bodyLen !== len) len = String(len).length + bodyLen;
  return Buffer.from(`${len}${body}`);
}

/** Zero-pad `data` to a whole number of 512-byte blocks. */
export function pad(data: Buffer): Buffer {
  const rest = data.length % BLOCK;
  return rest === 0 ? data : Buffer.concat([data, Buffer.alloc(BLOCK - rest)]);
}

/** Header blocks of one entry, PAX header first when the path needs one. `seq` numbers the PAX name. */
export function entryHeader(
  archivePath: string,
  type: "file" | "dir",
  mode: number,
  size: number,
  seq: number,
): Buffer {
  if (size > SIZE_MAX) throw new ArchiveError(`cannot archive '${archivePath}': file too large`);
  const typeflag = type === "dir" ? "5" : "0";
  const split = splitPath(archivePath);
  if (split !== null) return buildBlock({ ...split, mode, size, typeflag });
  const record = paxRecord("path", archivePath);
  const pax = buildBlock({
    name: `PaxHeader/${seq}`,
    prefix: "",
    mode: 0o644,
    size: record.length,
    typeflag: "x",
  });
  // The ustar fields keep an ASCII stand-in that a reader without PAX support shows as-is.
  const stand = archivePath.replace(/[^\x20-\x7e]/g, "_").slice(0, NAME_MAX);
  const main = buildBlock({ name: stand, prefix: "", mode, size, typeflag });
  return Buffer.concat([pax, pad(record), main]);
}

// tar-reader.ts — test-only ustar + PAX reader over zlib.gunzipSync (spec 0257 R11).
//
// An independent decoder, so the writer is proven against code that does not share its helpers
// and the Windows run needs no host `tar`. It verifies each header checksum and honours the PAX
// `path` record; every other record is ignored.

import fs from "node:fs";
import zlib from "node:zlib";

export type TarRecord = {
  path: string;
  type: "file" | "dir";
  mode: number;
  mtime: number;
  uid: number;
  gid: number;
  uname: string;
  data: Buffer;
};

const BLOCK = 512;

function text(block: Buffer, start: number, length: number): string {
  const field = block.subarray(start, start + length);
  const nul = field.indexOf(0);
  return field.subarray(0, nul === -1 ? length : nul).toString("utf8");
}

function octal(block: Buffer, start: number, length: number): number {
  const value = text(block, start, length).trim();
  return value === "" ? 0 : parseInt(value, 8);
}

function checksumOf(block: Buffer): number {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : (block[i] ?? 0);
  return sum;
}

/** Read the value of the `path` record out of a PAX data block, or null when it has none. */
function paxPath(data: Buffer): string | null {
  let offset = 0;
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);
    const len = Number(data.subarray(offset, space).toString("latin1"));
    const record = data.subarray(space + 1, offset + len - 1).toString("utf8");
    const eq = record.indexOf("=");
    if (record.slice(0, eq) === "path") return record.slice(eq + 1);
    offset += len;
  }
  return null;
}

export function readTarGz(file: string): TarRecord[] {
  const tar = zlib.gunzipSync(fs.readFileSync(file));
  const records: TarRecord[] = [];
  let pending: string | null = null;
  let offset = 0;
  while (offset + BLOCK <= tar.length) {
    const block = tar.subarray(offset, offset + BLOCK);
    offset += BLOCK;
    if (block.every((byte) => byte === 0)) break;
    if (checksumOf(block) !== octal(block, 148, 8))
      throw new Error(`bad checksum at ${offset - BLOCK}`);
    const size = octal(block, 124, 12);
    const data = tar.subarray(offset, offset + size);
    offset += Math.ceil(size / BLOCK) * BLOCK;
    const typeflag = text(block, 156, 1);
    if (typeflag === "x") {
      pending = paxPath(data);
      continue;
    }
    const prefix = text(block, 345, 155);
    const name = text(block, 0, 100);
    records.push({
      path: pending ?? (prefix === "" ? name : `${prefix}/${name}`),
      type: typeflag === "5" ? "dir" : "file",
      mode: octal(block, 100, 8),
      mtime: octal(block, 136, 12),
      uid: octal(block, 108, 8),
      gid: octal(block, 116, 8),
      uname: text(block, 265, 32),
      data: Buffer.from(data),
    });
    pending = null;
  }
  return records;
}

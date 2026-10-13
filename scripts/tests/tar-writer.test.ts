// tar-writer.test.ts — the deterministic release archive writer (spec 0257 R10, R11).
//
// The archive is read back with the independent reader in lib/tar-reader.ts, and cross-checked
// against the host's `gzip` and `tar` whenever they exist (the skips name the missing binary).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import zlib from "node:zlib";
import { sha256File } from "../lib/packaging/digest.ts";
import {
  ArchiveError,
  buildTar,
  gzipTar,
  walkTree,
  writeArchive,
} from "../lib/packaging/tar-writer.ts";
import { readTarGz } from "./lib/tar-reader.ts";

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), "tar-writer-"));
after(() => fs.rmSync(BASE, { recursive: true, force: true }));

const WIN = process.platform === "win32";
let counter = 0;

function fresh(name: string): string {
  const dir = path.join(BASE, `${name}-${counter++}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function put(root: string, rel: string, content: string, mode?: number): void {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  if (mode !== undefined && !WIN) fs.chmodSync(file, mode);
}

/** A tree with a sibling that sorts before a directory ("a-b" < "a/"), an empty directory and an executable. */
function sampleTree(name: string): string {
  const root = fresh(name);
  put(root, "z.txt", "last\n", 0o644);
  put(root, "a/x.txt", "inside a\n", 0o600);
  put(root, "a-b", "sibling\n", 0o664);
  put(root, "bin/run", "#!/bin/sh\necho hi\n", 0o775);
  fs.mkdirSync(path.join(root, "empty"));
  return root;
}

function archiveOf(root: string, name: string, opts?: { platform?: NodeJS.Platform }): string {
  const file = path.join(fresh(name), "out.tar.gz");
  writeArchive(root, file, opts);
  return file;
}

function missing(bin: string): string | false {
  const res = spawnSync(bin, ["--version"], { encoding: "utf8" });
  return res.error !== undefined ? `${bin} is not installed` : false;
}

describe("walk and headers", () => {
  const root = sampleTree("walk");
  const records = readTarGz(archiveOf(root, "walk-out"));

  test("entries come in byte order of their path, the root `./` first", () => {
    const paths = records.map((r) => r.path);
    assert.equal(paths[0], "./");
    assert.deepEqual(paths, [
      "./",
      "./a-b",
      "./a/",
      "./a/x.txt",
      "./bin/",
      "./bin/run",
      "./empty/",
      "./z.txt",
    ]);
    const bytes = paths.map((p) => Buffer.from(p));
    for (let i = 1; i < bytes.length; i++) {
      assert.ok(Buffer.compare(bytes[i - 1] as Buffer, bytes[i] as Buffer) < 0);
    }
  });

  test("a directory is listed before its contents and an empty directory is kept", () => {
    const paths = records.map((r) => r.path);
    assert.ok(paths.indexOf("./a/") < paths.indexOf("./a/x.txt"));
    assert.ok(paths.indexOf("./bin/") < paths.indexOf("./bin/run"));
    assert.equal(records.find((r) => r.path === "./empty/")?.type, "dir");
  });

  test("time, owner and group are fixed, user and group names empty", () => {
    for (const r of records) {
      assert.equal(r.mtime, 946684800, r.path);
      assert.equal(r.uid, 0, r.path);
      assert.equal(r.gid, 0, r.path);
      assert.equal(r.uname, "", r.path);
    }
  });

  test(
    "directories are 0755, files 0755 with an execute bit and 0644 otherwise",
    { skip: WIN },
    () => {
      const modes = Object.fromEntries(records.map((r) => [r.path, r.mode]));
      assert.equal(modes["./"], 0o755);
      assert.equal(modes["./a/"], 0o755);
      assert.equal(modes["./bin/run"], 0o755);
      assert.equal(modes["./a/x.txt"], 0o644);
      assert.equal(modes["./a-b"], 0o644);
      assert.equal(modes["./z.txt"], 0o644);
    },
  );

  test("contents read back byte for byte", () => {
    for (const r of records.filter((x) => x.type === "file")) {
      assert.deepEqual(r.data, fs.readFileSync(path.join(root, r.path)), r.path);
    }
  });
});

test("on win32 a file starting with `#!` gets 0755 and any other file 0644", () => {
  const root = fresh("shebang");
  put(root, "tool", "#!/usr/bin/env node\n");
  put(root, "doc.md", "# title\n");
  put(root, "one", "#");
  const modes = Object.fromEntries(
    walkTree(root, { platform: "win32" }).map((e) => [e.path, e.mode]),
  );
  assert.equal(modes["./tool"], 0o755);
  assert.equal(modes["./doc.md"], 0o644);
  assert.equal(modes["./one"], 0o644);
});

describe("long and non-ASCII paths", () => {
  test("a path longer than 255 characters goes through a PAX header and reads back whole", () => {
    const root = fresh("pax");
    const deep = Array.from({ length: 5 }, (_, i) => String(i).repeat(60)).join("/");
    put(root, `${deep}/file.txt`, "deep\n");
    const file = archiveOf(root, "pax-out");
    const records = readTarGz(file);
    assert.ok(records.some((r) => r.path === `./${deep}/file.txt`));
    assert.ok(records.some((r) => r.path === `./${deep}/` && r.type === "dir"));
    const tar = zlib.gunzipSync(fs.readFileSync(file));
    assert.ok(tar.includes(Buffer.from("PaxHeader/")), "no PAX header in the stream");
  });

  test("a path that fits only through the prefix field needs no PAX header", () => {
    const root = fresh("prefix");
    const deep = Array.from({ length: 2 }, (_, i) => String(i).repeat(70)).join("/");
    put(root, `${deep}/f`, "x\n");
    const file = archiveOf(root, "prefix-out");
    assert.ok(readTarGz(file).some((r) => r.path === `./${deep}/f`));
    assert.ok(!zlib.gunzipSync(fs.readFileSync(file)).includes(Buffer.from("PaxHeader/")));
  });

  test("a non-ASCII name is carried by a PAX header and reads back whole", () => {
    const root = fresh("unicode");
    put(root, "café/日本.txt", "ok\n");
    const records = readTarGz(archiveOf(root, "unicode-out"));
    assert.ok(records.some((r) => r.path === "./café/日本.txt"));
    assert.ok(records.some((r) => r.path === "./café/"));
  });
});

describe("gzip and determinism", () => {
  test("the gzip header has a zero time and the Unix OS byte", () => {
    const gz = fs.readFileSync(archiveOf(sampleTree("gzip"), "gzip-out"));
    assert.deepEqual([...gz.subarray(4, 8)], [0, 0, 0, 0]);
    assert.equal(gz[9], 3);
    const forced = gzipTar(Buffer.alloc(1024));
    assert.equal(forced[9], 3);
    assert.deepEqual([...forced.subarray(4, 8)], [0, 0, 0, 0]);
  });

  test("two equal trees built at different times give identical streams and files", () => {
    const a = sampleTree("det-a");
    const b = sampleTree("det-b");
    const past = new Date("2001-02-03T04:05:06Z");
    for (const rel of ["z.txt", "a-b", "a/x.txt", "bin/run", "a", "empty"])
      fs.utimesSync(path.join(b, rel), past, past);
    const fileA = archiveOf(a, "det-out-a");
    const fileB = archiveOf(b, "det-out-b");
    assert.deepEqual(
      zlib.gunzipSync(fs.readFileSync(fileA)),
      zlib.gunzipSync(fs.readFileSync(fileB)),
    );
    assert.deepEqual(fs.readFileSync(fileA), fs.readFileSync(fileB));
  });

  test("buildTar ends on two zero blocks and a whole number of blocks", () => {
    const tar = buildTar(walkTree(sampleTree("blocks")));
    assert.equal(tar.length % 512, 0);
    assert.ok(tar.subarray(tar.length - 1024).every((byte) => byte === 0));
  });

  test("sha256File matches node:crypto over the same bytes", () => {
    const file = archiveOf(sampleTree("digest"), "digest-out");
    const expected = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    assert.equal(sha256File(file), expected);
    assert.match(sha256File(file), /^[0-9a-f]{64}$/);
  });
});

test("a symbolic link is refused by relative path and no archive is written", { skip: WIN }, () => {
  const root = fresh("link");
  put(root, "sub/real.txt", "x\n");
  fs.symlinkSync("real.txt", path.join(root, "sub", "link"));
  const file = path.join(fresh("link-out"), "out.tar.gz");
  assert.throws(
    () => writeArchive(root, file),
    (err: unknown) =>
      err instanceof ArchiveError &&
      err.message === "cannot archive 'sub/link': not a regular file or directory",
  );
  assert.equal(fs.existsSync(file), false);
});

describe("host cross-checks", () => {
  const root = sampleTree("host");
  put(
    root,
    `${Array.from({ length: 5 }, (_, i) => String(i).repeat(60)).join("/")}/file.txt`,
    "deep\n",
  );
  const file = archiveOf(root, "host-out");
  const expected = readTarGz(file);

  test("gzip -t accepts the archive", { skip: missing("gzip") }, () => {
    const res = spawnSync("gzip", ["-t", file], { encoding: "utf8" });
    assert.equal(res.status, 0, res.stderr);
  });

  test(
    "tar lists the same paths in the same order with the same modes",
    { skip: missing("tar") },
    () => {
      const names = spawnSync("tar", ["-tzf", file], { encoding: "utf8" });
      assert.equal(names.status, 0, names.stderr);
      assert.deepEqual(
        names.stdout.split("\n").filter((l) => l !== ""),
        expected.map((r) => r.path),
      );
      const verbose = spawnSync("tar", ["-tzvf", file], { encoding: "utf8" });
      assert.equal(verbose.status, 0, verbose.stderr);
      const listed = verbose.stdout.split("\n").filter((l) => l !== "");
      assert.equal(listed.length, expected.length);
      listed.forEach((line, i) => {
        const record = expected[i];
        assert.ok(record !== undefined);
        const perms = line.split(/\s+/)[0] ?? "";
        assert.equal(perms[0], record.type === "dir" ? "d" : "-", line);
        assert.equal(perms.slice(1, 4) === "rwx", (record.mode & 0o100) !== 0, line);
      });
    },
  );

  test("tar -x reproduces the source tree", { skip: missing("tar") }, () => {
    const out = fresh("extract");
    const res = spawnSync("tar", ["-xzf", file, "-C", out], { encoding: "utf8" });
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(snapshot(out), snapshot(root));
  });
});

/** Relative path, kind, content and execute bit of everything below `dir`, in a stable order. */
function snapshot(dir: string): string[] {
  const rows: string[] = [];
  const walk = (current: string, rel: string): void => {
    for (const name of fs.readdirSync(current).sort()) {
      const abs = path.join(current, name);
      const relPath = rel === "" ? name : `${rel}/${name}`;
      const stat = fs.lstatSync(abs);
      if (stat.isDirectory()) {
        rows.push(`d ${relPath}`);
        walk(abs, relPath);
      } else {
        const exec = !WIN && (stat.mode & 0o111) !== 0 ? "x" : "-";
        const sum = crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
        rows.push(`f ${exec} ${relPath} ${sum}`);
      }
    }
  };
  walk(dir, "");
  return rows;
}

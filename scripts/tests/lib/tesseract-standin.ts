// tesseract-standin.ts — a stand-in `tesseract` on a temporary search path (spec 0259 R17).
//
// installTesseractStandIn({ "a.png": tsv }) writes <bin>/tesseract that prints the scripted
// TSV for the PNG whose basename it is given (exit 1 for an unscripted PNG) and answers
// `--version`. On Linux and macOS it is a POSIX sh script, usable by both the shell leg and
// the TypeScript leg. On win32 it is a copy of node.exe named tesseract.exe (a spawn without
// a shell cannot run a .cmd) that Node turns into the stand-in through a NODE_OPTIONS
// `--require` preload; `env()` adds that variable there. `noTesseractEnv()` gives a PATH
// without any tesseract (symlinks to the few tools the shell leg needs).

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export interface StandIn {
  readonly binDir: string;
  /** `base` with the stand-in first on PATH (and the win32 preload variable). */
  env(base?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
  dispose(): void;
}

export interface OcrWord {
  text: string;
  left: number;
  top: number;
  width?: number;
  height?: number;
  /** TSV level column; the checks keep only level 5. */
  level?: number;
}

const HEADER =
  "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext";

/** Tesseract-shaped TSV (header plus one row per word). */
export function tsvOf(words: readonly OcrWord[]): string {
  const rows = words.map(
    (w) =>
      `${w.level ?? 5}\t1\t1\t1\t1\t1\t${w.left}\t${w.top}\t${w.width ?? 50}\t${w.height ?? 20}\t95\t${w.text}`,
  );
  return `${[HEADER, ...rows].join("\n")}\n`;
}

const WIN = process.platform === "win32";

const SH = `#!/bin/sh
if [ "$1" = "--version" ]; then echo "tesseract 5.0.0 stand-in"; exit 0; fi
dir=$(dirname "$0")
name=\${1##*/}
if [ ! -f "$dir/tsv/$name.tsv" ]; then exit 1; fi
cat "$dir/tsv/$name.tsv"
`;

const PRELOAD = `const fs = require("node:fs");
const path = require("node:path");
if (path.basename(process.execPath).toLowerCase() === "tesseract.exe") {
  const a = process.argv.slice(1);
  if (a[0] === "--version") { console.log("tesseract 5.0.0 stand-in"); process.exit(0); }
  const f = path.join(path.dirname(process.execPath), "tsv", path.basename(a[0]) + ".tsv");
  if (!fs.existsSync(f)) process.exit(1);
  process.stdout.write(fs.readFileSync(f), () => process.exit(0));
}
`;

function pathKey(env: NodeJS.ProcessEnv): string {
  return Object.keys(env).find((k) => k.toLowerCase() === "path") ?? "PATH";
}

export function installTesseractStandIn(tsvByPng: Readonly<Record<string, string>>): StandIn {
  const binDir = mkdtempSync(path.join(tmpdir(), "tesseract-standin-"));
  mkdirSync(path.join(binDir, "tsv"));
  for (const [name, tsv] of Object.entries(tsvByPng)) {
    writeFileSync(path.join(binDir, "tsv", `${name}.tsv`), tsv);
  }
  if (WIN) {
    copyFileSync(process.execPath, path.join(binDir, "tesseract.exe"));
    writeFileSync(path.join(binDir, "standin.cjs"), PRELOAD);
  } else {
    writeFileSync(path.join(binDir, "tesseract"), SH, { mode: 0o755 });
  }
  return {
    binDir,
    env(base = process.env) {
      const key = pathKey(base);
      const env: NodeJS.ProcessEnv = {
        ...base,
        [key]: `${binDir}${path.delimiter}${base[key] ?? ""}`,
      };
      if (WIN) env["NODE_OPTIONS"] = `--require "${path.join(binDir, "standin.cjs")}"`;
      return env;
    },
    dispose() {
      rmSync(binDir, { recursive: true, force: true });
    },
  };
}

/** An environment whose PATH holds no tesseract: only symlinks to `tools` found on the host. */
export function noTesseractEnv(
  tools: readonly string[] = ["dirname", "python3", "bash"],
  base: NodeJS.ProcessEnv = process.env,
): { env: NodeJS.ProcessEnv; dispose(): void } {
  const dir = mkdtempSync(path.join(tmpdir(), "no-tesseract-"));
  if (!WIN) {
    for (const tool of tools) {
      const found = spawnSync("sh", ["-c", `command -v ${tool}`], { encoding: "utf8" });
      const target = found.status === 0 ? found.stdout.trim() : "";
      if (target.startsWith("/")) symlinkSync(target, path.join(dir, tool));
    }
  }
  return {
    env: { ...base, [pathKey(base)]: dir },
    dispose() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

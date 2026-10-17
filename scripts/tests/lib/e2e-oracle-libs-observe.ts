// e2e-oracle-libs-observe.ts — the scratch sandbox of the library oracle (spec 0261 R9): `makeSandbox`
// builds it, `finishSandbox` describes what a case left behind (return code, both streams, every file
// under `work/`). The shell runner is removed with the shell libraries; the TypeScript twins run in the
// same sandbox against the recorded goldens. Nothing here touches the real HOME or any account.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { writeLauncher } from "./e2e-docker-standin.ts";
import { normalise } from "./e2e-normalise.ts";
import type { LibCase, LibTuple } from "./e2e-oracle-libs-types.ts";

export const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

function walk(dir: string, base: string, out: Record<string, { content: string; mode: string }>) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else if (entry.isFile()) {
      const rel = path.relative(base, full).split(path.sep).join("/");
      const mode = (fs.statSync(full).mode & 0o777).toString(8).padStart(4, "0");
      out[rel] = { content: fs.readFileSync(full, "latin1"), mode };
    }
  }
}

export interface Sandbox {
  readonly root: string;
  readonly work: string;
  readonly home: string;
  readonly bin: string;
  readonly env: Record<string, string>;
}

/** Scratch tree and environment of one case: the shell and the TypeScript run in the same one. */
export function makeSandbox(c: LibCase): Sandbox {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-libs-"));
  const work = path.join(root, "work");
  const home = path.join(root, "home");
  const bin = path.join(root, "bin");
  for (const d of [work, home, bin, path.join(root, "tmp")]) fs.mkdirSync(d, { recursive: true });
  for (const f of c.seed ?? []) {
    const target = path.join(work, f.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, f.content, "latin1");
    if (f.mode !== undefined) fs.chmodSync(target, f.mode);
  }
  if (c.forbidDockerRun) writeLauncher(bin);
  const env: Record<string, string> = {
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    HOME: home,
    TMPDIR: path.join(root, "tmp"),
    LC_ALL: "C",
    E2E_LIB_DIR: path.join(REPO_ROOT, "tests", "e2e", "lib"),
    ...(c.forbidDockerRun ? { E2E_STANDIN_FORBID_RUN: "1" } : {}),
  };
  for (const [k, v] of Object.entries(c.env ?? {})) env[k] = v.split("{WORK}").join(work);
  return { root, work, home, bin, env };
}

export interface Outcome {
  readonly rc: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Describe what the call did: the files and modes under `work/`, normalised, then drop the sandbox. */
export function finishSandbox(c: LibCase, box: Sandbox, out: Outcome): LibTuple {
  const files: Record<string, { content: string; mode: string }> = {};
  walk(box.work, box.work, files);
  const stats: Record<string, string> = {};
  for (const rel of c.statPaths ?? []) {
    try {
      stats[rel] = (fs.statSync(path.join(box.work, rel)).mode & 0o777)
        .toString(8)
        .padStart(4, "0");
    } catch {
      stats[rel] = "absent";
    }
  }
  const ctx = { tmp: box.root, home: box.home, e2eHome: path.join(box.home, ".crewrig-e2e") };
  const fixed = (s: string) => normalise(s, ctx);
  const tuple: LibTuple = {
    id: c.id,
    rc: out.rc,
    stdout: fixed(out.stdout),
    stderr: fixed(out.stderr),
    stats,
    files: Object.fromEntries(
      Object.entries(files).map(([k, v]) => [k, { content: fixed(v.content), mode: v.mode }]),
    ),
  };
  fs.rmSync(box.root, { recursive: true, force: true });
  return tuple;
}

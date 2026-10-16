// e2e-oracle-libs-observe.ts — run one LibCase through the SHELL library in a scratch sandbox and
// describe what it did (spec 0261 R9): return code, both streams, every file under `work/`.
// `bash -c 'source "$LIB"; fn "$@"'` with LC_ALL=C, HOME and TMPDIR inside the sandbox, CI and
// NODE_TEST_CONTEXT removed. Needs bash >= 4 for the harness libraries: `shellLibPrerequisites()`
// returns the skip reason. Nothing here touches the real HOME or any account.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { writeLauncher } from "./e2e-docker-standin.ts";
import { normalise } from "./e2e-normalise.ts";
import type { LibCase, LibTuple } from "./e2e-oracle-libs-types.ts";

export const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

export function shellLibPrerequisites(tools: readonly string[] = []): string | null {
  const v = spawnSync("bash", ["-c", 'echo "${BASH_VERSINFO[0]}"'], { encoding: "utf8" });
  if (v.status !== 0 || Number(v.stdout.trim()) < 4) return "bash >= 4 is required";
  for (const t of tools) {
    if (spawnSync("sh", ["-c", `command -v ${t}`]).status !== 0) return `${t} is required`;
  }
  return null;
}

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

export function observeLib(c: LibCase): LibTuple {
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
  const libPath = path.join(REPO_ROOT, c.lib);
  const argv = c.script
    ? [libPath, ...(c.args ?? [])]
    : [
        "-c",
        'source "$1"; fn="$2"; vars="$3"; shift 3; "$fn" "$@"; rc=$?; ' +
          'for v in $vars; do printf "%s=%s\\n" "$v" "${!v-}"; done; exit "$rc"',
        "bash",
        libPath,
        c.fn,
        (c.printVars ?? []).join(" "),
        ...(c.args ?? []),
      ];
  const res = spawnSync("bash", argv, { cwd: work, env, input: c.stdin ?? "", encoding: "latin1" });
  const files: Record<string, { content: string; mode: string }> = {};
  walk(work, work, files);
  const stats: Record<string, string> = {};
  for (const rel of c.statPaths ?? []) {
    try {
      stats[rel] = (fs.statSync(path.join(work, rel)).mode & 0o777).toString(8).padStart(4, "0");
    } catch {
      stats[rel] = "absent";
    }
  }
  const ctx = { tmp: root, home, e2eHome: path.join(home, ".crewrig-e2e") };
  const fixed = (s: string) => normalise(s, ctx).split(REPO_ROOT).join("<REPO>");
  const tuple: LibTuple = {
    id: c.id,
    rc: res.status ?? -1,
    stdout: fixed(res.stdout),
    stderr: fixed(res.stderr),
    stats,
    files: Object.fromEntries(
      Object.entries(files).map(([k, v]) => [k, { content: fixed(v.content), mode: v.mode }]),
    ),
  };
  fs.rmSync(root, { recursive: true, force: true });
  return tuple;
}

// core-paths.ts — the logic of scripts/check-core-paths.ts (spec 0259 req 12).
//
// Three directions: manifest to HEAD (`git cat-file -e HEAD:<path>`), built-output
// directories (asked of the repository's own builder entry, spawned with
// `process.execPath`, never in process) to manifest, and `model-mappings/` targets
// (`git ls-tree`) to `excluded` org carve-outs. The messages name
// `scripts/build-components.sh` as the shell does, the entry stays a public shim.
//
// Usage: runCorePaths(repoDir) returns the ordered output lines and the exit status.
// Exit codes: 0 agree, 1 finding, 2 missing or unqueryable input.
// Finding-line format: the shell's `  FAIL <path> (<policy>) — ...` and `  - <item>`.

import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { runGit } from "./git-run.ts";
import { isGoverned, parseManifest } from "./core-paths-manifest.ts";
import type { ManifestEntry } from "./core-paths-manifest.ts";

export interface Line {
  stream: "stdout" | "stderr";
  text: string;
}
export interface CorePathsResult {
  lines: Line[];
  code: number;
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** The builder's `--list-output-dirs` lines, or `null` when the query failed. */
export function queryOutputDirs(buildScript: string): string[] | null {
  const res = spawnSync(process.execPath, [buildScript, "--list-output-dirs"], {
    encoding: "utf8",
    stdio: ["inherit", "pipe", "ignore"],
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error !== undefined || res.status !== 0) return null;
  const out: string[] = [];
  for (let line of res.stdout.replace(/\n+$/, "").split("\n")) {
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (line !== "") out.push(line);
  }
  return out;
}

/** Supported-target stems found under `model-mappings/` at HEAD, deduplicated in order. */
function targetStems(repoDir: string): string[] {
  const res = runGit(["ls-tree", "-r", "--name-only", "HEAD", "--", "model-mappings/"], {
    cwd: repoDir,
  });
  const stems: string[] = [];
  if (res.status !== 0 && res.stdout.length === 0) return stems;
  const lines = res.stdout.toString("utf8").split("\n");
  for (const line of lines) {
    if (line === "") continue;
    const base = line.slice(line.lastIndexOf("/") + 1);
    let stem: string;
    if (base.endsWith(".org.yml")) stem = base.slice(0, -".org.yml".length);
    else if (base.endsWith(".yml")) stem = base.slice(0, -".yml".length);
    else continue;
    if (!stems.includes(stem)) stems.push(stem);
  }
  return stems;
}

function listSection(out: Line[], items: readonly string[], render: (i: string) => string): void {
  for (const i of items) out.push({ stream: "stderr", text: render(i) });
}

export function runCorePaths(repoDir: string): CorePathsResult {
  const out: Line[] = [];
  const err = (text: string): void => void out.push({ stream: "stderr", text });
  const done = (code: number): CorePathsResult => ({ lines: out, code });

  const manifest = path.join(repoDir, ".crewrig", "core-paths.txt");
  if (!isFile(manifest)) {
    err(`Error: manifest not found: ${manifest}`);
    return done(2);
  }
  let entries: ManifestEntry[];
  try {
    entries = parseManifest(readFileSync(manifest, "utf8"));
  } catch (e) {
    err(`Error: ${manifest}: ${(e as Error).message}`);
    return done(1);
  }

  const builder = path.join(repoDir, "scripts", "build-components.ts");
  const named = path.join(repoDir, "scripts", "build-components.sh");
  if (!isFile(builder)) {
    err(`Error: build script not found: ${builder}`);
    err("The reverse direction (spec 0121 R5) derives the built-output directory");
    err("set from this file. A rename must be followed here — it must never");
    err("silently retire the guard.");
    return done(2);
  }
  const derived = queryOutputDirs(builder);
  if (derived === null) {
    err(
      `Error: failed to query built-output directories from build script: ${named} --list-output-dirs`,
    );
    return done(2);
  }

  const failures: string[] = [];
  let checked = 0;
  for (const { path: p, policy } of entries) {
    if (policy === "excluded") continue;
    checked += 1;
    if (runGit(["cat-file", "-e", `HEAD:${p}`], { cwd: repoDir }).status !== 0) {
      err(`  FAIL ${p} (${policy}) — does not resolve to tracked content at HEAD`);
      failures.push(p);
    }
  }
  if (failures.length > 0) {
    err("");
    err(`FAILED: ${failures.length} core-paths manifest entr(y/ies) do not resolve at HEAD:`);
    listSection(out, failures, (p) => `  - ${p}`);
    err("");
    err("Every strict/adopt-on-edit/regenerable entry in .crewrig/core-paths.txt must");
    err("resolve to tracked content at HEAD (spec 0031). Either commit the missing");
    err("content, or remove the manifest entry (and its docs/layers.md row, per the");
    err("co-maintenance rule in AGENTS.md).");
    return done(1);
  }
  out.push({
    stream: "stdout",
    text: `OK: all ${checked} strict/adopt-on-edit/regenerable core-paths entries resolve at HEAD.`,
  });

  const ungoverned = derived.filter((d) => !isGoverned(entries, d));
  if (ungoverned.length > 0) {
    err("");
    err(
      `FAILED: ${ungoverned.length} of ${derived.length} built-output director(y/ies) derived from`,
    );
    err("scripts/build-components.sh carry no upstream-sync guarantee:");
    listSection(out, ungoverned, (d) => `  - ${d}`);
    err("");
    err("Every directory the component build writes component outputs into must be");
    err("governed by .crewrig/core-paths.txt with a strict, adopt-on-edit, or");
    err("regenerable policy (spec 0121 R2, spec 0121 delta-01 R8). Add the entry, and");
    err("its docs/layers.md row in the same diff per the co-maintenance rule in");
    err("AGENTS.md.");
    return done(1);
  }
  out.push({
    stream: "stdout",
    text: `OK: all ${derived.length} built-output directories derived from scripts/build-components.sh are governed.`,
  });

  const stems = targetStems(repoDir);
  const uncarved = stems.filter(
    (t) =>
      !entries.some((e) => e.path === `model-mappings/${t}.org.yml` && e.policy === "excluded"),
  );
  if (uncarved.length > 0) {
    err("");
    err(`FAILED: ${uncarved.length} of ${stems.length} supported target(s) have no`);
    err("excluded org channel carve-out in .crewrig/core-paths.txt:");
    listSection(out, uncarved, (t) => `  - ${t} (expected: model-mappings/${t}.org.yml  excluded)`);
    err("");
    err("Every supported target's org channel file must carry an excluded manifest");
    err("entry (spec 0199 R41), nested under the strict model-mappings parent. Add");
    err("the entry, and its docs/layers.md row in the same diff per the");
    err("co-maintenance rule in AGENTS.md.");
    return done(1);
  }
  out.push({
    stream: "stdout",
    text: `OK: all ${stems.length} supported target(s) carry an excluded org channel carve-out.`,
  });
  return done(0);
}

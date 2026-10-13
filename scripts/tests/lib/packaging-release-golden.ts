// packaging-release-golden.ts — the stored form of a case's observation (spec 0257 R25):
// `fixtures/packaging-release/<case>/{stdout,stderr,status}.golden` and `files/**`. Every stored
// name ends in `.golden` and no stored file starts with `#!`, so the ratchet counts nothing.
// Names are made portable: `dist/` and `build/` would be hidden by `.gitignore`, and a character
// outside `[A-Za-z0-9._@-]` (a backslash, an emoji) is percent-encoded.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { Difference } from "./packaging-release-deviations.ts";
import type { FileObs, Observed } from "./packaging-release-observe.ts";

export const GOLDEN_ROOT = path.resolve(import.meta.dirname, "..", "fixtures", "packaging-release");

/** Stored files, relative to the case directory, with their latin1 content. */
export type GoldenFiles = Map<string, string>;

function encodeSegment(segment: string): string {
  if (segment === "dist" || segment === "build") return `_${segment}`;
  return segment
    .replaceAll("<VERSION>", "@VERSION@")
    .replace(/[^A-Za-z0-9._@-]/g, (ch) =>
      Array.from(
        Buffer.from(ch, "utf8"),
        (b) => `%${b.toString(16).toUpperCase().padStart(2, "0")}`,
      ).join(""),
    );
}

const encode = (rel: string): string => rel.split("/").map(encodeSegment).join("/");

function stored(obs: FileObs): [string, string] {
  if (obs.kind === "archive") {
    return [
      ".entries.json.golden",
      `${JSON.stringify({ entries: obs.entries, stream: obs.stream }, null, 2)}\n`,
    ];
  }
  if (obs.kind === "binary" || obs.text.startsWith("#!")) {
    const sha = obs.kind === "binary" ? obs.sha256 : "shebang";
    return [".sha256.golden", `${sha}\n`];
  }
  return [".golden", obs.text];
}

export function goldenFiles(obs: Observed): GoldenFiles {
  const out: GoldenFiles = new Map([
    ["status.golden", `${obs.status}\n`],
    ["stdout.golden", obs.stdout],
    ["stderr.golden", obs.stderr],
  ]);
  // The rendered build tree is intermediate and large (a node_modules copy): pin its hashes only.
  const build: Record<string, string> = {};
  for (const [rel, file] of Object.entries(obs.files)) {
    if (rel.startsWith("build/") && file.kind !== "archive") {
      build[rel] =
        file.kind === "binary"
          ? file.sha256
          : crypto.createHash("sha256").update(file.text, "latin1").digest("hex");
      continue;
    }
    const [suffix, content] = stored(file);
    out.set(`files/${encode(rel)}${suffix}`, content);
  }
  if (Object.keys(build).length > 0)
    out.set("files/_build.sha256.json.golden", `${JSON.stringify(build, null, 2)}\n`);
  return out;
}

/** The shell observation with every tagged difference replaced by the TypeScript value. */
export function pinTs(shell: Observed, ts: Observed, diffs: readonly Difference[]): Observed {
  const out: Observed = { ...shell, files: { ...shell.files } };
  for (const { field } of diffs) {
    if (field === "status") out.status = ts.status;
    else if (field === "stdout") out.stdout = ts.stdout;
    else if (field === "stderr") out.stderr = ts.stderr;
    else {
      const rel = field.slice(field.indexOf(" ") + 1);
      const mine = ts.files[rel];
      if (mine === undefined) delete out.files[rel];
      else out.files[rel] = mine;
    }
  }
  return out;
}

export function readGolden(name: string): GoldenFiles {
  const out: GoldenFiles = new Map();
  const walk = (dir: string, rel: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const at = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), at);
      else out.set(at, fs.readFileSync(path.join(dir, entry.name)).toString("latin1"));
    }
  };
  walk(path.join(GOLDEN_ROOT, name), "");
  return out;
}

export function writeGolden(name: string, files: GoldenFiles): void {
  const dir = path.join(GOLDEN_ROOT, name);
  fs.rmSync(dir, { recursive: true, force: true });
  for (const [rel, content] of files) {
    const file = path.join(dir, ...rel.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(content, "latin1"));
  }
}

/** Human-readable differences between two stored sets, empty when equal. */
export function compareGolden(actual: GoldenFiles, expected: GoldenFiles): string[] {
  const out: string[] = [];
  for (const rel of new Set([...actual.keys(), ...expected.keys()])) {
    const a = actual.get(rel);
    const e = expected.get(rel);
    if (a === undefined) out.push(`${rel}: stored but not produced`);
    else if (e === undefined) out.push(`${rel}: produced but not stored`);
    else if (a !== e) out.push(`${rel}: expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`);
  }
  return out;
}

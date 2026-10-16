// governance-tee.ts — the shell-versus-TypeScript comparison wrapper of the governance
// differential harness (spec 0259 R26). Entry run by the stub installTee writes:
//   node governance-tee.ts <name> [args...]
// With identical argv, stdin, cwd and env it runs (a) `LC_ALL=C bash scripts/<name>.sh.shell`
// and (b) `node scripts/<name>.ts`, then compares stdout, stderr and exit status. On any
// difference it writes both transcripts to stderr and exits 99; otherwise it replays leg (a).
//
// Case flags (environment, set by installTee):
//   GOVERNANCE_TEE_MUTATING=1     the check writes files; leg (b) runs in a copy taken BEFORE
//                                 leg (a) and the post-run file trees (and bytes) are compared.
//   GOVERNANCE_TEE_STATUS_ONLY=1  deviation (d): only the exit status is compared.
// The sandbox root is three levels above this file (scripts/tests/lib/).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface Leg {
  readonly status: number;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const [name, ...args] = process.argv.slice(2);
if (name === undefined || name === "") {
  process.stderr.write("governance-tee: usage: governance-tee.ts <name> [args...]\n");
  process.exit(2);
}
const mutating = process.env["GOVERNANCE_TEE_MUTATING"] === "1";
const statusOnly = process.env["GOVERNANCE_TEE_STATUS_ONLY"] === "1";

function readStdin(): Buffer {
  try {
    return fs.readFileSync(0);
  } catch {
    return Buffer.alloc(0);
  }
}

/** Relative path -> hex bytes of every regular file under `dir`, `.git` excluded. */
function fileTree(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (current === dir && entry.name === ".git") continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else
        out.set(
          path.relative(dir, full),
          entry.isFile() ? fs.readFileSync(full).toString("hex") : "<non-file>",
        );
    }
  };
  walk(dir);
  return new Map([...out].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

function run(
  cmd: string,
  argv: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  input: Buffer,
): Leg {
  const r = spawnSync(cmd, argv, {
    cwd,
    env,
    input,
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

const input = readStdin();
const cwd = process.cwd();
const inRoot = cwd === root || cwd.startsWith(root + path.sep);
let snapshot: string | undefined;
let snapRoot = root;
let snapCwd = cwd;
if (mutating) {
  // Copy BEFORE leg (a): the whole sandbox when cwd is inside it (the script and its libs
  // then resolve inside the copy too), otherwise the working directory alone.
  snapshot = fs.mkdtempSync(path.join(os.tmpdir(), "gov-tee-"));
  const from = inRoot ? root : cwd;
  fs.cpSync(from, snapshot, { recursive: true, dereference: false, verbatimSymlinks: true });
  if (inRoot) {
    snapRoot = snapshot;
    snapCwd = path.join(snapshot, path.relative(root, cwd));
  } else {
    snapCwd = snapshot;
  }
}

const a = run(
  "bash",
  [path.join(root, "scripts", `${name}.sh.shell`), ...args],
  cwd,
  { ...process.env, LC_ALL: "C" },
  input,
);
const b = run(
  process.execPath,
  [
    "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
    path.join(snapRoot, "scripts", `${name}.ts`),
    ...args,
  ],
  snapCwd,
  process.env,
  input,
);

const reasons: string[] = [];
if (a.status !== b.status) reasons.push(`exit status: shell ${a.status}, typescript ${b.status}`);
if (!statusOnly) {
  if (!a.stdout.equals(b.stdout)) reasons.push("stdout differs");
  if (!a.stderr.equals(b.stderr)) reasons.push("stderr differs");
}
if (mutating && snapshot !== undefined) {
  const ta = fileTree(inRoot ? root : cwd);
  const tb = fileTree(snapshot);
  const keys = [...new Set([...ta.keys(), ...tb.keys()])].sort();
  const bad = keys.filter((k) => ta.get(k) !== tb.get(k));
  if (bad.length > 0) reasons.push(`file trees differ: ${bad.join(", ")}`);
}
if (snapshot !== undefined) fs.rmSync(snapshot, { recursive: true, force: true });

if (reasons.length > 0) {
  const show = (label: string, l: Leg): string =>
    `--- ${label} (exit ${l.status}) stdout:\n${l.stdout.toString()}--- ${label} stderr:\n${l.stderr.toString()}`;
  process.stderr.write(
    `governance-tee: DIVERGENCE in ${name}: ${reasons.join("; ")}\n${show("shell", a)}${show("typescript", b)}`,
  );
  process.exit(99);
}
process.stdout.write(a.stdout);
process.stderr.write(a.stderr);
process.exit(a.status);

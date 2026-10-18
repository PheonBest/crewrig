// e2e-capture-versions.ts — TypeScript twin of e2e-capture-versions.sh (spec 0261 R1-R4, R24).
//
// Usage: node scripts/e2e-capture-versions.ts <image-prefix> <lockfile-path>
//
// Captures the resolved CLI/tool versions of the five built e2e images into a lockfile. Exit 1 when
// an image is missing (before any `docker run`). A field that resolves to nothing is written as
// `<unknown>`; the shell's exit-2 path is dead code (see below), so the twin never exits 2.

import fs from "node:fs";
import path from "node:path";

import { runTool } from "../tests/e2e/lib/exec.ts";

type Env = Readonly<Record<string, string>>;

const FIELDS: ReadonlyArray<
  readonly [string, "base" | "claude" | "gemini" | "copilot" | "mempalace", string]
> = [
  ["base.debian", "base", "cat /etc/debian_version"],
  ["base.node", "base", "node --version"],
  ["base.npm", "base", "npm --version"],
  ["base.python", "base", "python3 --version"],
  ["base.pipx", "base", "pipx --version"],
  ["base.gh", "base", "gh --version | head -n1"],
  ["base.yq", "base", "yq --version"],
  ["base.jq", "base", "jq --version"],
  [
    "base.ollama",
    "base",
    'ollama --version 2>&1 | sed -nE "s/.*client version is ([0-9A-Za-z.+-]+).*/\\\\1/p" | head -n1',
  ],
  ["claude.cli", "claude", "claude --version"],
  ["gemini.cli", "gemini", "gemini --version"],
  ["copilot.cli", "copilot", "copilot --version 2>&1 | head -n1"],
  ["mempalace.cli", "mempalace", "mempalace --version 2>&1 | head -n1"],
];

function capture(image: string, snippet: string, cwd: string, env: Env): string {
  const res = runTool(
    "docker",
    ["run", "--rm", "--entrypoint", "/bin/bash", image, "-c", snippet],
    {
      cwd,
      env,
    },
  );
  return (res.stdout.split("\n")[0] ?? "").replaceAll("\r", "");
}

export function main(argv: readonly string[], env: Env, now: Date = new Date()): number {
  const prefix = argv[0] || "crewrig/e2e";
  const lockfile = argv[1] || "docker/e2e/.versions.lock";
  const images = {
    base: `${prefix}-base:latest`,
    claude: `${prefix}-claude:latest`,
    gemini: `${prefix}-gemini:latest`,
    copilot: `${prefix}-copilot:latest`,
    mempalace: `${prefix}-mempalace:latest`,
  } as const;
  const cwd = process.cwd();
  const missing = Object.values(images).filter(
    (img) => runTool("docker", ["image", "inspect", img], { cwd, env }).rc !== 0,
  );
  if (missing.length > 0) {
    process.stderr.write(
      `ERROR: required image(s) not found locally:\n${missing.map((m) => `  - ${m}\n`).join("")}Run 'task e2e:build' first.\n`,
    );
    return 1;
  }
  const v: Record<string, string> = {};
  for (const [name, which, snippet] of FIELDS) {
    const value = capture(images[which], snippet, cwd, env);
    // The shell records the empty field inside a command-substitution subshell, so its
    // `empty_fields` stays empty and it never exits 2: the twin keeps that observable contract.
    v[name] = value === "" ? "<unknown>" : value;
  }
  const capturedAt = now.toISOString().replace(/\.\d+Z$/, "Z");
  const lines = [
    "# Resolved versions captured by `task e2e:build`.",
    "# Populated automatically — do not edit manually.",
    "# Regenerate with: task e2e:lock (after task e2e:build).",
    `captured_at=${capturedAt}`,
    "",
    ...FIELDS.slice(0, 9).map(([n]) => `${n}=${v[n]}`),
    "",
    ...FIELDS.slice(9).map(([n]) => `${n}=${v[n]}`),
  ];
  const text = `${lines.join("\n")}\n`;
  fs.mkdirSync(path.dirname(lockfile), { recursive: true });
  fs.writeFileSync(lockfile, text);
  process.stdout.write(`Wrote ${lockfile}\n${text}`);
  return 0;
}

function stringEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
  );
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename) {
  process.exitCode = main(process.argv.slice(2), stringEnv());
}

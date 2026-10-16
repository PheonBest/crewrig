// e2e-probe-antigravity-differential.test.ts — every case of
// scripts/tests/test-antigravity-discovery-probe.sh, run through the shell probe and its
// TypeScript twin, requiring the same stdout, stderr, exit status and files left behind.
// The stub `agy` is written at test time; HOME is a scratch directory per leg.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { shellLegSkipReason } from "./lib/e2e-shim.ts";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const shellProbe = path.join(repo, "scripts/probe-antigravity-discovery.sh");
const tsProbe = path.join(repo, "scripts/probe-antigravity-discovery.ts");
const MARKER = "crewrig-1342-probe-hang-marker";

const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agy-diff-")));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const stub = path.join(scratch, "agy-stub.sh");
fs.writeFileSync(
  stub,
  `#!/bin/bash
if [ "\${1:-}" = "agents" ]; then
  printf '%s\\n' "\${STUB_AGENTS_LISTING:-crewrig-probe-agent-dup}"
  exit 0
fi
prompt="\${2:-}"
case "\${STUB_MODE:-answer}" in
  hang)
    ( exec -a "${MARKER}" sleep 300 ) &
    wait
    ;;
  empty)
    :
    ;;
  *)
    printf '%s\\n' "$prompt" \\
      | grep -oE 'crewrig-probe-[a-z-]+|agy-customizations' \\
      | sort -u \\
      | while read -r n; do
          if [ "$n" = "\${STUB_OMIT:-}" ]; then continue; fi
          echo "$n=\${STUB_VERDICT:-YES}"
        done
    ;;
esac
`,
  { mode: 0o755 },
);

const hasBash = spawnSync("bash", ["--version"]).status === 0;
const shellSkip =
  (hasBash ? false : "the shell leg needs bash on the PATH") || shellLegSkipReason(shellProbe);

interface Run {
  readonly stdout: string;
  readonly stderr: string;
  readonly status: number | null;
  readonly tree: string;
}

function treeOf(root: string): string {
  const lines: string[] = [];
  const walk = (dir: string): void => {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const rel = path.relative(root, full);
      if (fs.statSync(full).isDirectory()) {
        lines.push(`d ${rel}`);
        walk(full);
      } else lines.push(`f ${rel} ${fs.readFileSync(full, "utf8")}`);
    }
  };
  walk(root);
  return lines.join("\n");
}

// The shell leg sometimes lets bash print the job notice of its own watchdog subshell
// ("Terminated: 15 ... sleep" on macOS, a bare "Terminated" on Linux) on stderr: a race in the shell, never printed by the twin.
const JOB_NOTICE = /^Terminated(: 15 .*)?\n/gm;

let counter = 0;
function runLeg(
  leg: "shell" | "ts",
  extra: Record<string, string>,
  prepare?: (h: string) => void,
): Run {
  const home = path.join(scratch, `home-${leg}-${counter++}`);
  fs.mkdirSync(home, { recursive: true });
  prepare?.(home);
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: home,
    TMPDIR: scratch,
    AGY_BIN: stub,
    AGY_PROBE_TIMEOUT: "1",
    ...extra,
  };
  const [cmd, args] =
    leg === "shell"
      ? ["bash", [shellProbe]]
      : [process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", tsProbe]];
  const r = spawnSync(cmd as string, args as string[], { env, encoding: "utf8", cwd: repo });
  const norm = (t: string): string => t.split(home).join("<HOME>").split(stub).join("<STUB>");
  return {
    stdout: norm(r.stdout),
    stderr: norm(r.stderr).replace(JOB_NOTICE, ""),
    status: r.status,
    tree: treeOf(home),
  };
}

function survivors(): string {
  const ps = spawnSync("ps", ["-A", "-o", "pid=,command="], { encoding: "utf8" }).stdout ?? "";
  return ps
    .split("\n")
    .filter((l) => l.includes(MARKER) && !l.includes("ps -A"))
    .join("\n");
}

function both(
  name: string,
  extra: Record<string, string>,
  check?: (r: Run) => void,
  prepare?: (h: string) => void,
  hang = false,
): void {
  test(name, { skip: shellSkip }, () => {
    const sh = runLeg("shell", extra, prepare);
    if (hang) assert.equal(survivors(), "", "shell leg left a child behind");
    const ts = runLeg("ts", extra, prepare);
    if (hang) assert.equal(survivors(), "", "TypeScript leg left a child behind");
    assert.equal(ts.stdout, sh.stdout, "stdout");
    assert.equal(ts.stderr, sh.stderr, "stderr");
    assert.equal(ts.status, sh.status, "exit status");
    assert.equal(ts.tree, sh.tree, "files left behind");
    check?.(ts);
  });
}

const verdict = (out: string, name: string): string | undefined =>
  out
    .split("\n")
    .find((l) => l.trim().split(/\s+/)[1] === name)
    ?.trim()
    .split(/\s+/)[0];

for (const shape of ["captured", "direct"]) {
  describe(`call shape: ${shape}`, () => {
    const sh = { AGY_PROBE_ASK_SHAPE: shape };
    both("an all-YES answer exits 0 and classifies FOUND", { ...sh, STUB_VERDICT: "YES" }, (r) => {
      assert.equal(r.status, 0);
      assert.equal(verdict(r.stdout, "crewrig-probe-skill-config"), "FOUND");
    });
    both(
      "an all-NO answer exits 0 and classifies NOT-FOUND",
      { ...sh, STUB_VERDICT: "NO" },
      (r) => {
        assert.equal(r.status, 0);
        assert.equal(verdict(r.stdout, "crewrig-probe-skill-config"), "NOT-FOUND");
      },
    );
    both(
      "an omitted line is INDETERMINATE and exits non-zero",
      { ...sh, STUB_VERDICT: "NO", STUB_OMIT: "crewrig-probe-skill-config" },
      (r) => {
        assert.equal(verdict(r.stdout, "crewrig-probe-skill-config"), "INDETERMINATE");
        assert.equal(verdict(r.stdout, "crewrig-probe-skill-appdata"), "NOT-FOUND");
        assert.notEqual(r.status, 0);
        assert.match(r.stderr, /INDETERMINATE[\s\S]*re-run before recording/);
      },
    );
    both("an empty answer is INDETERMINATE", { ...sh, STUB_MODE: "empty" }, (r) => {
      assert.equal(verdict(r.stdout, "crewrig-probe-skill-config"), "INDETERMINATE");
      assert.notEqual(r.status, 0);
    });
    both(
      "a call that exceeds the bound is INDETERMINATE and leaves nothing running",
      { ...sh, STUB_MODE: "hang" },
      (r) => {
        assert.equal(verdict(r.stdout, "crewrig-probe-skill-config"), "INDETERMINATE");
        assert.notEqual(r.status, 0);
      },
      undefined,
      true,
    );
    both(
      "no job control: a bounded-out call is INDETERMINATE and leaves nothing running",
      { ...sh, STUB_MODE: "hang", AGY_FORCE_NO_JOB_CONTROL: "1" },
      (r) => {
        assert.equal(verdict(r.stdout, "crewrig-probe-skill-config"), "INDETERMINATE");
        assert.notEqual(r.status, 0);
      },
      undefined,
      true,
    );
  });
}

describe("re-runnability (R13)", () => {
  both(
    "a pre-existing sentinel name aborts with status 1 and is left untouched",
    {},
    (r) => {
      assert.equal(r.status, 1);
      assert.match(r.stderr, /refusing to run/);
      assert.match(r.tree, /someone else's file/);
    },
    (h) => {
      const d = path.join(h, ".gemini/config/skills/crewrig-probe-skill-config");
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, "SKILL.md"), "someone else's file\n");
    },
  );
  both(
    "the tree is restored exactly, including a pre-existing empty directory",
    { STUB_VERDICT: "YES" },
    (r) => {
      assert.match(r.tree, /d \.gemini\/antigravity-cli\/agents/);
      assert.match(r.tree, /f \.gemini\/skills\/user-owned\/SKILL\.md mine/);
      assert.doesNotMatch(r.tree, /crewrig-probe/);
    },
    (h) => {
      fs.mkdirSync(path.join(h, ".gemini/antigravity-cli/agents"), { recursive: true });
      fs.mkdirSync(path.join(h, ".gemini/skills/user-owned"), { recursive: true });
      fs.writeFileSync(path.join(h, ".gemini/skills/user-owned/SKILL.md"), "mine\n");
    },
  );
  both("a missing binary is a precondition failure", { AGY_BIN: "agy-does-not-exist" }, (r) => {
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not found in PATH/);
  });
});

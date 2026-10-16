// e2e-probes-antigravity-discovery.test.ts — scripts/tests/test-antigravity-discovery-probe.sh run
// against `scripts/probe-antigravity-discovery.ts` alone (spec 0261 R11, R17; spec 0123 R13, R14).
// Overlap note: e2e-probe-antigravity-differential.test.ts runs the same cases through shell and
// TypeScript legs and skips the shell leg once the .sh is a shim; this file keeps the literal
// expectations. Hermetic: HOME and AGY_BIN point into a scratch root; no `agy`, no network.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const PROBE = path.join(REPO, "scripts", "probe-antigravity-discovery.ts");
const MARKER = "crewrig-1342-probe-hang-marker-b";
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agy-disc-")));
after(() => fs.rmSync(root, { recursive: true, force: true }));

const stub = path.join(root, "agy-stub.sh");
fs.writeFileSync(
  stub,
  `#!/bin/bash
if [ "\${1:-}" = "agents" ]; then printf '%s\\n' "\${STUB_AGENTS_LISTING:-crewrig-probe-agent-dup}"; exit 0; fi
prompt="\${2:-}"
case "\${STUB_MODE:-answer}" in
  hang) ( exec -a "${MARKER}" sleep 300 ) & wait ;;
  empty) : ;;
  *) printf '%s\\n' "$prompt" | grep -oE 'crewrig-probe-[a-z-]+|agy-customizations' | sort -u \\
       | while read -r n; do [ "$n" = "\${STUB_OMIT:-}" ] && continue; echo "$n=\${STUB_VERDICT:-YES}"; done ;;
esac
`,
  { mode: 0o755 },
);

function run(name: string, shape: string, extra: Record<string, string> = {}) {
  const home = path.join(root, `home-${name}-${shape}`);
  fs.mkdirSync(home, { recursive: true });
  const r = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", PROBE], {
    encoding: "utf8",
    env: {
      PATH: process.env["PATH"] ?? "",
      HOME: home,
      AGY_BIN: stub,
      AGY_PROBE_TIMEOUT: "1",
      AGY_PROBE_ASK_SHAPE: shape,
      ...extra,
    },
  });
  return { out: r.stdout + r.stderr, st: r.status };
}
const verdictFor = (out: string, sentinel: string) =>
  out
    .split("\n")
    .map((l) => l.trim().split(/\s+/))
    .find((w) => w[1] === sentinel)?.[0];
const survivors = () => {
  const r = spawnSync("ps", ["-A", "-o", "pid=,command="], { encoding: "utf8" });
  const list = r.stdout.split("\n").filter((l) => l.includes(MARKER) && !l.includes("grep"));
  for (const l of list) {
    try {
      process.kill(Number(l.trim().split(/\s+/)[0]), "SIGKILL");
    } catch {
      /* gone */
    }
  }
  return list;
};

for (const shape of ["captured", "direct"]) {
  describe(`R14 classification, call shape ${shape}`, () => {
    const S = "crewrig-probe-skill-config";
    test("YES is FOUND, NO is NOT-FOUND, both exit 0", () => {
      const y = run("yes", shape, { STUB_VERDICT: "YES" });
      assert.equal(y.st, 0);
      assert.equal(verdictFor(y.out, S), "FOUND");
      const n = run("no", shape, { STUB_VERDICT: "NO" });
      assert.equal(n.st, 0);
      assert.equal(verdictFor(n.out, S), "NOT-FOUND");
    });
    test("an omitted line is INDETERMINATE, answered sentinels still classify, exit non-zero", () => {
      const o = run("omit", shape, { STUB_VERDICT: "NO", STUB_OMIT: S });
      assert.equal(verdictFor(o.out, S), "INDETERMINATE");
      assert.equal(verdictFor(o.out, "crewrig-probe-skill-appdata"), "NOT-FOUND");
      assert.notEqual(o.st, 0);
      assert.match(o.out, /INDETERMINATE[\s\S]*re-run before recording/);
    });
    test("an empty answer is INDETERMINATE and exits non-zero", () => {
      const e = run("empty", shape, { STUB_MODE: "empty" });
      assert.equal(verdictFor(e.out, S), "INDETERMINATE");
      assert.notEqual(e.st, 0);
    });
    for (const [label, extra] of [
      ["bound exceeded", {}],
      ["no job control (#1222)", { AGY_FORCE_NO_JOB_CONTROL: "1" }],
    ] as const) {
      test(`${label}: INDETERMINATE, non-zero exit, nothing survives`, () => {
        const h = run(`hang-${label.slice(0, 2)}`, shape, { STUB_MODE: "hang", ...extra });
        assert.equal(verdictFor(h.out, S), "INDETERMINATE");
        assert.notEqual(h.st, 0);
        assert.deepEqual(survivors(), []);
      });
    }
  });
}

describe("R13 re-runnability", () => {
  test("a pre-existing sentinel name aborts with status 1 and is left untouched", () => {
    const home = path.join(root, "home-collide");
    const dir = path.join(home, ".gemini/config/skills/crewrig-probe-skill-config");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), "someone else's file\n");
    const r = spawnSync(
      process.execPath,
      ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", PROBE],
      {
        encoding: "utf8",
        env: { PATH: process.env["PATH"] ?? "", HOME: home, AGY_BIN: stub, AGY_PROBE_TIMEOUT: "1" },
      },
    );
    assert.equal(r.status, 1);
    assert.ok(fs.existsSync(path.join(dir, "SKILL.md")));
    assert.match(r.stdout + r.stderr, /refusing to run/);
  });
  test("the tree is identical before and after a clean run, empty dirs and user content included", () => {
    const home = path.join(root, "home-clean");
    fs.mkdirSync(path.join(home, ".gemini/antigravity-cli/agents"), { recursive: true });
    fs.mkdirSync(path.join(home, ".gemini/skills/user-owned"), { recursive: true });
    fs.writeFileSync(path.join(home, ".gemini/skills/user-owned/SKILL.md"), "mine\n");
    const list = () =>
      spawnSync("find", [".", "-print"], { cwd: home, encoding: "utf8" }).stdout.split("\n").sort();
    const before = list();
    spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", PROBE], {
      encoding: "utf8",
      env: {
        PATH: process.env["PATH"] ?? "",
        HOME: home,
        AGY_BIN: stub,
        AGY_PROBE_TIMEOUT: "1",
        STUB_VERDICT: "YES",
      },
    });
    assert.deepEqual(list(), before);
    assert.ok(fs.existsSync(path.join(home, ".gemini/antigravity-cli/agents")));
  });
});

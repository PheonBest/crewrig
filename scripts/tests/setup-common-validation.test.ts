// setup-common-validation.test.ts — the shell `configure_validation_backend` of
// scripts/lib/common.sh through its non-interactive path (the VALIDATION_* variables), plus the
// user-validate SKILL.md wording the gate-time fallback depends on (spec 0263, suite
// test-setup-validation-backend.sh). Retires with scripts/lib/common.sh (row J4); the shell
// groups are POSIX-only, the SKILL.md group runs everywhere. The TypeScript twin is covered by
// setup-validation.test.ts and the declaration group (G4) by setup-retarget-others.test.ts.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { bashLibs } from "./lib/bash-libs.ts";
import { cleanEnv, makePathDir, realTmp, REPO, SKIP_POSIX } from "./lib/worktree-fixtures.ts";

const SKILL_MD = path.join(REPO, "artifacts/library/skills/user-validate/SKILL.md");
const KEYS = [
  "VALIDATION_BACKEND",
  "VALIDATION_TRANSLATE",
  "VALIDATION_PEDAGOGY",
  "VALIDATION_ILLUSTRATION",
];

interface Run {
  readonly status: number | null;
  readonly stdout: string;
  readonly conf: string;
  readonly confFile: string;
  readonly tmpExists: boolean;
}

/** Run the helper under a scratch HOME with exactly `vars` set (no inherited VALIDATION_*). */
function configure(vars: Record<string, string>, opts: { path?: string; pre?: string } = {}): Run {
  const home = realTmp("crewrig-validation-");
  const confFile = path.join(home, ".crewrig", "validation.conf");
  if (opts.pre !== undefined) {
    fs.mkdirSync(path.dirname(confFile), { recursive: true });
    fs.writeFileSync(confFile, opts.pre);
  }
  const env = cleanEnv({ ...Object.fromEntries(KEYS.map((k) => [k, undefined])), ...vars });
  env["USERPROFILE"] = home;
  if (opts.path !== undefined) env["PATH"] = opts.path;
  // bashLibs creates its own HOME; point the helper at ours through a body-level override.
  const res = bashLibs(
    `HOME=${JSON.stringify(home)}\nconfigure_validation_backend\necho "rc=$?"`,
    env,
    ["common.sh"],
  );
  const m = /rc=(\d+)\s*$/.exec(res.stdout);
  return {
    status: m === null ? null : Number(m[1]),
    stdout: res.stdout,
    conf: fs.existsSync(confFile) ? fs.readFileSync(confFile, "utf8") : "",
    confFile,
    tmpExists: fs.existsSync(`${confFile}.tmp`),
  };
}

const dataLines = (conf: string): string[] =>
  conf.split("\n").filter((l) => l.trim() !== "" && !l.startsWith("#"));

/** The Bash `conf_get`: data lines only, split on the first `=`. */
function confGet(conf: string, key: string): string | undefined {
  for (const line of dataLines(conf)) {
    const i = line.indexOf("=");
    if (line.slice(0, i) === key) return line.slice(i + 1);
  }
  return undefined;
}

function assertWellFormed(r: Run, label: string): void {
  assert.equal(r.status, 0, `${label}: returns 0`);
  assert.equal(
    r.conf.split("\n").filter((l) => l.startsWith("#")).length,
    2,
    `${label}: 2-line header`,
  );
  const data = dataLines(r.conf);
  assert.equal(data.length, 4, `${label}: 4 data lines`);
  assert.deepEqual(data.map((l) => l.split("=")[0]).sort(), [
    "backend",
    "illustration",
    "pedagogy",
    "translate",
  ]);
  for (const l of data) assert.match(l, /^[a-z]+=[a-z]+$/, `${label}: lowercase key=value`);
  assert.equal(r.tmpExists, false, `${label}: no leftover .tmp`);
}

function assertValues(r: Run, want: readonly [string, string, string, string]): void {
  assert.deepEqual(
    ["backend", "translate", "pedagogy", "illustration"].map((k) => confGet(r.conf, k)),
    want,
  );
}

describe("shell configure_validation_backend", { skip: SKIP_POSIX }, () => {
  it("golden conf is well-formed per combination", () => {
    const a = configure({
      VALIDATION_BACKEND: "internal",
      VALIDATION_TRANSLATE: "on",
      VALIDATION_PEDAGOGY: "simple",
      VALIDATION_ILLUSTRATION: "on",
    });
    assertWellFormed(a, "internal/on/simple/on");
    assertValues(a, ["internal", "on", "simple", "on"]);
    const b = configure({
      VALIDATION_BACKEND: "plannotator",
      VALIDATION_TRANSLATE: "off",
      VALIDATION_PEDAGOGY: "professor",
      VALIDATION_ILLUSTRATION: "on",
    });
    assertWellFormed(b, "plannotator/off/professor/on");
    assertValues(b, ["plannotator", "off", "professor", "on"]);
  });

  it("every unset variable takes its default; any one variable selects the non-interactive path", () => {
    const only = configure({ VALIDATION_BACKEND: "plannotator" });
    assertWellFormed(only, "only-backend");
    assertValues(only, ["plannotator", "off", "contextual", "off"]);
    const tr = configure({ VALIDATION_TRANSLATE: "on" });
    assertWellFormed(tr, "only-translate");
    assertValues(tr, ["internal", "on", "contextual", "off"]);
    const pe = configure({ VALIDATION_PEDAGOGY: "simple" });
    assertValues(pe, ["internal", "off", "simple", "off"]);
    const il = configure({ VALIDATION_ILLUSTRATION: "on" });
    assertValues(il, ["internal", "off", "contextual", "on"]);
  });

  it("an invalid enum fails loudly and leaves the conf surface untouched", () => {
    const a = configure({ VALIDATION_BACKEND: "bogus" });
    assert.notEqual(a.status, 0);
    assert.ok(
      a.stdout.includes("  ERROR: invalid validation backend 'bogus' (want: internal|plannotator)"),
      a.stdout,
    );
    assert.equal(fs.existsSync(a.confFile), false, "no conf written");
    assert.equal(a.tmpExists, false);
    const seed = configure({
      VALIDATION_BACKEND: "internal",
      VALIDATION_TRANSLATE: "off",
      VALIDATION_PEDAGOGY: "contextual",
      VALIDATION_ILLUSTRATION: "off",
    });
    assert.equal(seed.status, 0);
    const b = configure(
      { VALIDATION_BACKEND: "internal", VALIDATION_PEDAGOGY: "bogus" },
      { pre: seed.conf },
    );
    assert.notEqual(b.status, 0);
    assert.match(b.stdout, /ERROR: invalid validation pedagogy 'bogus'/);
    assert.equal(b.conf, seed.conf, "pre-existing conf byte-unchanged");
    assert.equal(b.tmpExists, false);
  });

  it("plannotator is persisted verbatim whether or not the binary is on PATH", () => {
    const stub = makePathDir({ scripts: { plannotator: "exit 0" } });
    const present = configure(
      { VALIDATION_BACKEND: "plannotator" },
      { path: `${stub}${path.delimiter}${process.env["PATH"] ?? ""}` },
    );
    assert.equal(present.status, 0);
    assert.equal(confGet(present.conf, "backend"), "plannotator");
    const bare = makePathDir({});
    const absent = configure(
      { VALIDATION_BACKEND: "plannotator" },
      { path: `${bare}${path.delimiter}/usr/bin:/bin` },
    );
    assert.equal(absent.status, 0);
    assert.equal(confGet(absent.conf, "backend"), "plannotator");
    assert.match(absent.stdout, /'plannotator' is not on PATH yet/);
  });
});

describe("user-validate SKILL.md fallback wording", () => {
  it("documents the presence check and the gate-time fallback", () => {
    assert.ok(fs.existsSync(SKILL_MD), `missing ${SKILL_MD}`);
    const text = fs.readFileSync(SKILL_MD, "utf8");
    assert.ok(text.includes("plannotator --version"), "plannotator --version presence check");
    assert.match(text, /fall.?back to the .?internal.? backend/i);
  });
});

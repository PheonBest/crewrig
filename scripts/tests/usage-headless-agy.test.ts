// usage-headless-agy.test.ts — TypeScript port of group G15 of
// scripts/tests/test-usage-capture.sh (spec 0260, section `test-usage-capture.sh`).
//
// J3 deletes this file together with scripts/lib/usage-headless.sh (spec 0260 requirement 3)
//
// It sources the Bash library in a child bash and calls
// `usage_headless_agy_rewrite_json_response <out_file> <instant>` under two PATH shims:
// mktemp forces every temp path under the sandbox TMPDIR (BSD mktemp does not reliably
// honour TMPDIR), and node scans TMPDIR for the reply canary after every node step.
// POSIX-only (Bash library).
//
//   G15 (1) out file == .response byte for byte; (2) exactly one record stored and the
//   canary absent from the usage root; (3) no TMPDIR file ever held the reply; (4) TMPDIR
//   empty afterwards; (5) non-JSON and (6) non-string `response` files left byte-identical.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { FIXTURES_DIR, hermeticEnv, mkTemp, REPO } from "./lib/usage-capture-fixtures.ts";
import { SKIP_POSIX, which } from "./lib/worktree-fixtures.ts";

const LIB = path.join(REPO, "scripts", "lib", "usage-headless.sh");
const ENVELOPE_DIR = path.join(FIXTURES_DIR, "headless", "antigravity-envelope");
const INSTANT = "2026-01-01T00:00:00.000Z";

let work = "";
let tmpdir = "";
let usageRoot = "";
let bin = "";
let scanLog = "";
let canary = "";

function rewrite(outFile: string): void {
  const bash = which("bash");
  assert.ok(bash, "bash is required");
  const env = hermeticEnv(path.join(work, "home"), {
    PATH: `${bin}:/usr/bin:/bin`,
    TMPDIR: tmpdir,
    CREWRIG_USAGE_ROOT: usageRoot,
  });
  spawnSync(
    bash,
    [
      "-c",
      `. "$1"; usage_headless_agy_rewrite_json_response "$2" "$3"`,
      "_",
      LIB,
      outFile,
      INSTANT,
    ],
    {
      env,
      encoding: "utf8",
    },
  );
}

function journalCount(): number {
  const dir = path.join(usageRoot, "journal");
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(d, e.name));
      else if (e.name.endsWith(".json") && !/\.(wing|attr)\.json$/.test(e.name)) n += 1;
    }
  };
  walk(dir);
  return n;
}

function filesHolding(dir: string, needle: string): string[] {
  const hits: string[] = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (fs.readFileSync(full, "utf8").includes(needle)) hits.push(full);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return hits;
}

describe("G15 R18: usage_headless_agy_rewrite_json_response", { skip: SKIP_POSIX }, () => {
  const outFile = () => path.join(work, "agy-out.txt");

  before(() => {
    work = mkTemp("crewrig-agy-");
    tmpdir = path.join(work, "tmpdir");
    usageRoot = path.join(work, "usage-root");
    bin = path.join(work, "bin");
    scanLog = path.join(work, "scan.log");
    for (const d of [tmpdir, usageRoot, bin, path.join(work, "home")]) fs.mkdirSync(d);
    fs.writeFileSync(scanLog, "");
    const expected = JSON.parse(
      fs.readFileSync(path.join(ENVELOPE_DIR, "expected.json"), "utf8"),
    ) as { forbiddenText: string[] };
    canary = expected.forbiddenText[0] ?? "";
    const realMktemp = which("mktemp");
    assert.ok(realMktemp, "mktemp is required");
    fs.writeFileSync(
      path.join(bin, "mktemp"),
      `#!/bin/bash\nexec "${realMktemp}" "$@" "${tmpdir}/tmp.XXXXXXXXXX"\n`,
      { mode: 0o755 },
    );
    fs.writeFileSync(
      path.join(bin, "node"),
      `#!/bin/bash\n"${process.execPath}" "$@"\nrc=$?\ngrep -rlF -- "${canary}" "${tmpdir}" >> "${scanLog}" 2>/dev/null\nexit $rc\n`,
      { mode: 0o755 },
    );
    fs.copyFileSync(path.join(ENVELOPE_DIR, "envelope.json"), outFile());
    rewrite(outFile());
  });

  after(() => fs.rmSync(work, { recursive: true, force: true }));

  test("G15 §10: out file now holds exactly the envelope's .response, byte for byte", () => {
    const envelope = JSON.parse(
      fs.readFileSync(path.join(ENVELOPE_DIR, "envelope.json"), "utf8"),
    ) as { response: string };
    assert.deepEqual(fs.readFileSync(outFile()), Buffer.from(envelope.response));
  });

  test("G15 §10: exactly one record stored, no file under the usage root holds the canary", () => {
    assert.equal(journalCount(), 1);
    assert.deepEqual(filesHolding(usageRoot, canary), []);
  });

  test("G15 §10: no file under TMPDIR held the reply after any node step", () => {
    assert.equal(fs.readFileSync(scanLog, "utf8"), "");
  });

  test("G15 §10: TMPDIR holds no leftover file after the call", () => {
    assert.deepEqual(fs.readdirSync(tmpdir), []);
  });

  for (const [name, text] of [
    ["agy-nonjson.txt", "agy: error: deadline exceeded"],
    ["agy-nonstring.txt", '{"conversation_id":"c","status":"error","response":null}\n'],
  ] as const) {
    test(`G15 §10: ${name} is left byte-identical`, () => {
      const file = path.join(work, name);
      fs.writeFileSync(file, text);
      rewrite(file);
      assert.deepEqual(fs.readFileSync(file), Buffer.from(text));
    });
  }
});

// usage-capture-shim.test.ts — TypeScript port of groups G7-G12 of
// scripts/tests/test-usage-capture.sh (spec 0260, section `test-usage-capture.sh`),
// driven through the forwarding shim `bash hooks/usage-capture.sh` (the `.ts` entry itself
// stays covered by usage-capture-hook.test.ts). POSIX-only: Bash shim.
//
//   G7  absolute path from a foreign cwd: exactly one journal entry
//   G8  leftover <root>/spool/<recordId>.json drained into the journal, spool emptied
//   G9  stamp present, source not newer: 3 readable payloads take the fast path;
//       no-path-key and unresolvable-path still reach capture
//   G10 relative-path.json with a literal-key stamp still reaches capture (i1-F2)
//   G11 source newer than the stamp reaches capture (utimesSync, no sleep)
//   G12 R15 exit-0 contract: node missing from PATH, nonexistent CLI override, throwing
//       stub: exit 0 and zero bytes on stdout and stderr

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { FIXTURES_DIR, hermeticEnv, mkTemp, REPO } from "./lib/usage-capture-fixtures.ts";
import { makePathDir, SKIP_POSIX, which } from "./lib/worktree-fixtures.ts";

const SHIM = path.join(REPO, "hooks", "usage-capture.sh");
const PAYLOADS = path.join(FIXTURES_DIR, "payloads");
const GONE = '{"transcript_path":"/home/agent/does/not/exist/unused.jsonl"}';
const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

let work = "";
let stub = "";
let n = 0;
const fresh = (label: string): string => {
  const dir = path.join(work, `${label}-${(n += 1)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

interface Run {
  readonly status: number | null;
  readonly output: string;
  readonly marker: boolean;
}

function runShim(
  root: string,
  stdin: string,
  opts: { cwd?: string; env?: Record<string, string | undefined>; path?: string } = {},
): Run {
  const marker = path.join(fresh("marker"), "ran");
  const env = hermeticEnv(path.join(work, "home"), {
    CREWRIG_USAGE_ROOT: root,
    STUB_MARKER: marker,
    CREWRIG_USAGE_CAPTURE_TEST: "1",
    CREWRIG_USAGE_CAPTURE_CLI: stub,
    ...opts.env,
  });
  if (opts.path !== undefined) env.PATH = opts.path;
  const bash = which("bash");
  assert.ok(bash, "bash is required");
  const res = spawnSync(bash, [SHIM, "claude-code", "Stop"], {
    input: stdin,
    cwd: opts.cwd ?? fresh("cwd"),
    env,
    encoding: "utf8",
  });
  return {
    status: res.status,
    output: `${res.stdout}${res.stderr}`,
    marker: fs.existsSync(marker),
  };
}

function journalEntries(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(d, e.name));
      else if (e.name.endsWith(".json") && !/\.(wing|attr)\.json$/.test(e.name)) out.push(e.name);
    }
  };
  walk(path.join(root, "journal"));
  return out;
}

function stampFor(root: string, key: string, ageSeconds: number): string {
  const dir = path.join(root, "state", "claude-code");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = path.join(dir, `${sha(key)}.stamp`);
  fs.writeFileSync(stamp, "");
  const t = new Date(Date.now() - ageSeconds * 1000);
  fs.utimesSync(stamp, t, t);
  return stamp;
}

function source(content: string, ageSeconds: number): string {
  const file = path.join(fresh("src"), "t.jsonl");
  fs.writeFileSync(file, content);
  const t = new Date(Date.now() - ageSeconds * 1000);
  fs.utimesSync(file, t, t);
  return file;
}

const payload = (name: string, src: string): string =>
  fs.readFileSync(path.join(PAYLOADS, name), "utf8").replaceAll("__TRANSCRIPT_PATH__", src);

describe("usage-capture.sh shim (G7-G12)", { skip: SKIP_POSIX }, () => {
  before(() => {
    work = mkTemp("crewrig-shim-");
    fs.mkdirSync(path.join(work, "home"));
    stub = path.join(work, "marker-stub.js");
    fs.writeFileSync(
      stub,
      "require('fs').writeFileSync(process.env.STUB_MARKER, process.argv.slice(2).join(' '));\n",
    );
    fs.writeFileSync(path.join(work, "throw.js"), "throw new Error('deliberate throwing stub');\n");
  });
  after(() => fs.rmSync(work, { recursive: true, force: true }));

  test("G7 §7(a): absolute path from a foreign cwd gives exactly one journal entry", () => {
    const root = fresh("root");
    const run = runShim(root, GONE, {
      env: { CREWRIG_USAGE_CAPTURE_TEST: undefined, CREWRIG_USAGE_CAPTURE_CLI: undefined },
    });
    assert.equal(run.status, 0);
    assert.equal(journalEntries(root).length, 1);
  });

  test("G8 §7(a'): a leftover spool record is drained into the journal and spool is emptied", () => {
    const root = fresh("root");
    const sample = path.join(REPO, "schemas", "usage-record", "samples", "gemini-cli.json");
    const record = JSON.parse(fs.readFileSync(sample, "utf8")) as { recordId: string };
    fs.mkdirSync(path.join(root, "spool"));
    fs.writeFileSync(
      path.join(root, "spool", `${record.recordId}.json`),
      `${JSON.stringify(record)}\n`,
    );
    const run = runShim(root, GONE, {
      env: { CREWRIG_USAGE_CAPTURE_TEST: undefined, CREWRIG_USAGE_CAPTURE_CLI: undefined },
    });
    assert.equal(run.status, 0);
    assert.ok(journalEntries(root).includes(`${record.recordId}.json`), "spool record not drained");
    const spool = path.join(root, "spool");
    assert.deepEqual(fs.existsSync(spool) ? fs.readdirSync(spool) : [], []);
  });

  for (const name of ["compact-snake-case.json", "spaced-snake-case.json", "camel-case.json"]) {
    test(`G9 §7(b)(i): ${name} takes the fast path (stamp present, source not newer)`, () => {
      const root = fresh("root");
      const src = source("fixture transcript content\n", 10);
      stampFor(root, src, 0);
      assert.equal(runShim(root, payload(name, src)).marker, false);
    });
  }

  for (const name of ["no-path-key.json", "unresolvable-path.json"]) {
    test(`G9 §7(b)(ii): ${name} (unreadable) still reaches the capture step`, () => {
      const root = fresh("root");
      const src = source("fixture transcript content\n", 10);
      stampFor(root, src, 0);
      assert.equal(runShim(root, payload(name, src)).marker, true);
    });
  }

  test("G10 §7(b)(ii) i1-F2: relative-path.json reaches capture despite a literal-key stamp", () => {
    const root = fresh("root");
    const cwd = fresh("relcwd");
    fs.mkdirSync(path.join(cwd, "relative"));
    fs.writeFileSync(path.join(cwd, "relative", "p.jsonl"), "fixture transcript content\n");
    stampFor(root, "relative/p.jsonl", 0);
    assert.equal(runShim(root, payload("relative-path.json", ""), { cwd }).marker, true);
  });

  test("G11 §7(b)(iii): a source strictly newer than the stamp reaches the capture step", () => {
    const root = fresh("root");
    const src = source("appended, now newer than the stamp\n", 0);
    stampFor(root, src, 10);
    assert.equal(runShim(root, payload("compact-snake-case.json", src)).marker, true);
  });

  test("G12 §7(c): node missing from PATH, exit 0, zero bytes", () => {
    // A bin dir that holds only `dirname`: no node, and never /usr/bin.
    const dirname = which("dirname");
    assert.ok(dirname, "dirname is required");
    const bin = makePathDir({ links: { dirname } });
    try {
      const run = runShim(fresh("root"), GONE, { path: bin });
      assert.equal(run.status, 0);
      assert.equal(run.output, "");
    } finally {
      fs.rmSync(bin, { recursive: true, force: true });
    }
  });

  test("G12 §7(c): nonexistent CLI override, exit 0, zero bytes", () => {
    const run = runShim(fresh("root"), GONE, {
      env: { CREWRIG_USAGE_CAPTURE_CLI: "/no/such/cli.js" },
    });
    assert.equal(run.status, 0);
    assert.equal(run.output, "");
  });

  test("G12 §7(c): a throwing stub, exit 0, zero bytes", () => {
    const run = runShim(fresh("root"), GONE, {
      env: { CREWRIG_USAGE_CAPTURE_CLI: path.join(work, "throw.js") },
    });
    assert.equal(run.status, 0);
    assert.equal(run.output, "");
  });
});

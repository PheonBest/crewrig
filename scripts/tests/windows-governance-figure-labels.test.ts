// windows-governance-figure-labels.test.ts — the cross-system proof of check-figure-labels.ts
// (spec 0259 R17, R26-R28). On Windows the entry runs from PowerShell, elsewhere from the default
// shell. (a) the real repository without tesseract on PATH prints the [SKIP] note and exits 0;
// (b) a fixture with the Node-based stand-in tesseract passes; (c) a fixture with a missing label
// fails with FAIL lines and exit 1. Interpreters are resolved from the PARENT PATH before the
// child PATH is narrowed. The `windows-governance-checks` job runs every
// `windows-governance-*.test.ts` file.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { defaultIsFile } from "../lib/worktree-claim/launch-windows.ts";
import {
  expectStatus,
  resolveInterpreters,
  sandboxPath,
  spawnEntry,
  why,
} from "./lib/windows-proof-support.ts";
import type { Run } from "./lib/windows-proof-support.ts";
import { installTesseractStandIn, tsvOf } from "./lib/tesseract-standin.ts";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const NO_WARN = "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON";
const SKIP_LINE = "[SKIP] tesseract is not installed. Skipping figure label OCR check.\n";

let root = "";
let copy = ""; // a minimal repository: the entry, its modules, and fixture figures
let bare = ""; // an empty directory standing for "no tesseract"

before(() => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "windows-figure-labels-")));
  bare = path.join(root, "bare");
  copy = path.join(root, "copy");
  fs.mkdirSync(bare);
  const lib = path.join(copy, "scripts", "lib");
  fs.mkdirSync(lib, { recursive: true });
  fs.copyFileSync(
    path.join(repo, "scripts", "check-figure-labels.ts"),
    path.join(copy, "scripts", "check-figure-labels.ts"),
  );
  fs.copyFileSync(
    path.join(repo, "scripts", "lib", "sequence-matcher.ts"),
    path.join(lib, "sequence-matcher.ts"),
  );
  fs.cpSync(path.join(repo, "scripts", "lib", "governance"), path.join(lib, "governance"), {
    recursive: true,
  });
  fs.copyFileSync(path.join(repo, "package.json"), path.join(copy, "package.json"));
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

function run(entry: string, script: string, bin: string, nodeOptions = NO_WARN): Run {
  // Resolved from the parent environment, before spawnEntry narrows the child PATH.
  const interpreters = resolveInterpreters({
    platform: process.platform,
    env: process.env,
    isFile: defaultIsFile,
  });
  console.log(`windows-governance-figure-labels: ${entry}: ${interpreters.notes.join("; ")}`);
  return spawnEntry({
    entry,
    script,
    args: [],
    shell: "pwsh",
    env: { GIT_CONFIG_NOSYSTEM: "1", NODE_OPTIONS: nodeOptions },
    home: root,
    bin,
    interpreters,
  });
}

/** Lay one fixture figure out under the copy's docs/assets. */
function figure(prompt: string, words: { text: string; left: number }[]): Record<string, string> {
  const assets = path.join(copy, "docs", "assets");
  fs.rmSync(assets, { recursive: true, force: true });
  fs.mkdirSync(assets, { recursive: true });
  fs.writeFileSync(path.join(assets, "flow.prompt.md"), prompt);
  fs.writeFileSync(path.join(assets, "flow.png"), "png");
  return { "flow.png": tsvOf(words.map((w) => ({ ...w, top: 10 }))) };
}

const aggregate = (r: Run, problems: string[]): void =>
  assert.deepEqual(problems, [], why(r, "aggregated failures"));

describe("windows governance figure labels: check-figure-labels", () => {
  it("skips with a note when tesseract is absent from PATH", () => {
    const probe = spawnSync("tesseract", ["--version"], {
      env: { PATH: sandboxPath(bare) },
      stdio: "ignore",
    });
    const absent = probe.error !== undefined;
    const r = run("figure-labels real", path.join(repo, "scripts", "check-figure-labels.ts"), bare);
    expectStatus(r, 0);
    const problems: string[] = [];
    const out = r.out.replaceAll("\r\n", "\n");
    // A host with tesseract inside the narrowed system directories really runs the check.
    if (absent && out !== SKIP_LINE)
      problems.push(`expected the [SKIP] note, got ${JSON.stringify(out)}`);
    if (!absent && !/^\[(PASS|INFO)\]/m.test(out)) problems.push("no verdict line from a real run");
    if (r.err !== "") problems.push(`unexpected stderr ${JSON.stringify(r.err)}`);
    aggregate(r, problems);
  });

  it("passes a fixture served by the Node-based stand-in tesseract", () => {
    const standIn = installTesseractStandIn(
      figure('Box text: "Claude Code"\nBox text: "Gemini CLI"\n', [
        { text: "Claude", left: 10 },
        { text: "Code", left: 70 },
        { text: "Gemini", left: 500 },
        { text: "CLI", left: 560 },
      ]),
    );
    try {
      const preload = standIn.env({})["NODE_OPTIONS"];
      const options = preload === undefined ? NO_WARN : `${NO_WARN} ${preload}`;
      const r = run(
        "figure-labels pass",
        path.join(copy, "scripts", "check-figure-labels.ts"),
        standIn.binDir,
        options,
      );
      expectStatus(r, 0);
      const problems: string[] = [];
      const out = r.out.replaceAll("\r\n", "\n");
      if (!out.includes("Checking docs/assets/flow.png (2 expected labels)..."))
        problems.push("missing the forward-slash `Checking` line");
      if (!out.includes("  RESULT: PASS for docs/assets/flow.png")) problems.push("no PASS result");
      if (!/\[PASS\] All 1 figure\(s\) passed label OCR verification\.\n$/.test(out))
        problems.push("no PASS summary");
      if (out.includes("\\")) problems.push("a backslash path in the output");
      aggregate(r, problems);
    } finally {
      standIn.dispose();
    }
  });

  it("fails a fixture with a missing label", () => {
    const standIn = installTesseractStandIn(
      figure('Box text: "Alpha"\nBox text: "Zebra Crossing"\n', [{ text: "Alpha", left: 10 }]),
    );
    try {
      const preload = standIn.env({})["NODE_OPTIONS"];
      const options = preload === undefined ? NO_WARN : `${NO_WARN} ${preload}`;
      const r = run(
        "figure-labels fail",
        path.join(copy, "scripts", "check-figure-labels.ts"),
        standIn.binDir,
        options,
      );
      expectStatus(r, 1);
      const problems: string[] = [];
      const out = r.out.replaceAll("\r\n", "\n");
      if (!out.includes("  ❌ [FAIL] Missing label: 'Zebra Crossing'"))
        problems.push("no Missing label line");
      if (!out.includes("  RESULT: FAIL for docs/assets/flow.png")) problems.push("no FAIL result");
      if (!/\[FAIL\] 1\/1 figure\(s\) failed label OCR verification\.\n$/.test(out))
        problems.push("no FAIL summary");
      if (out.includes("\\")) problems.push("a backslash path in the output");
      aggregate(r, problems);
    } finally {
      standIn.dispose();
    }
  });
});

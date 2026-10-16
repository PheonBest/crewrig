// check-figure-labels.test.ts — black-box test of scripts/check-figure-labels.ts with a
// stand-in `tesseract` on the search path (spec 0259 R17). The Bash suite only passes by
// skipping where tesseract is missing; this suite scripts the OCR output instead. Each case
// also runs scripts/check-figure-labels.sh on the same fixture and stand-in and compares
// stdout, stderr and exit status (bash and python3 needed: skipped locally when absent,
// a failure when CI is set).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  installTesseractStandIn,
  noTesseractEnv,
  tsvOf,
  type OcrWord,
} from "./lib/tesseract-standin.ts";

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WIN = process.platform === "win32";
const shellOk =
  !WIN &&
  spawnSync("bash", ["--version"]).status === 0 &&
  spawnSync("python3", ["--version"]).status === 0;
if (!WIN && !shellOk && process.env["CI"]) {
  throw new Error("bash and python3 are required in CI for the shell comparison");
}

let repo = "";

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

function exec(cmd: string, args: string[], env: NodeJS.ProcessEnv): Run {
  const r = spawnSync(cmd, args, { cwd: repo, encoding: "utf8", env });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const NODE_FLAGS = ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON"];
const runTs = (env: NodeJS.ProcessEnv): Run =>
  exec(
    process.execPath,
    [...NODE_FLAGS, path.join(repo, "scripts", "check-figure-labels.ts")],
    env,
  );
const runSh = (env: NodeJS.ProcessEnv): Run =>
  exec("bash", [path.join(repo, "scripts", "check-figure-labels.sh")], {
    ...env,
    LC_ALL: "C",
  });

interface Figure {
  name: string;
  prompt: string;
  words?: OcrWord[];
  /** Write the sidecar without a PNG. */
  noPng?: boolean;
}

/** Lay the figures out under docs/assets and return the stand-in serving their OCR. */
function setup(figures: Figure[]): ReturnType<typeof installTesseractStandIn> {
  rmSync(path.join(repo, "docs"), { recursive: true, force: true });
  mkdirSync(path.join(repo, "docs", "assets"), { recursive: true });
  const tsv: Record<string, string> = {};
  for (const f of figures) {
    const base = path.join(repo, "docs", "assets", f.name);
    mkdirSync(path.dirname(base), { recursive: true });
    writeFileSync(`${base}.prompt.md`, f.prompt);
    if (f.noPng !== true) {
      writeFileSync(`${base}.png`, "png");
      tsv[`${path.basename(f.name)}.png`] = tsvOf(f.words ?? []);
    }
  }
  return installTesseractStandIn(tsv);
}

/** Run the TS entry, optionally compare the shell script; return the TS run. */
function both(figures: Figure[]): Run {
  const standIn = setup(figures);
  try {
    const env = standIn.env();
    const ts = runTs(env);
    if (shellOk) {
      const sh = runSh(env);
      assert.deepEqual(ts, sh, "TypeScript entry and shell script diverge");
    }
    return ts;
  } finally {
    standIn.dispose();
  }
}

const box = (...labels: string[]): string => labels.map((l) => `Box text: "${l}"\n`).join("");
const at = (text: string, left: number, top = 10): OcrWord => ({ text, left, top });

before(() => {
  repo = mkdtempSync(path.join(tmpdir(), "figure-labels-"));
  mkdirSync(path.join(repo, "scripts", "lib"), { recursive: true });
  for (const f of ["check-figure-labels.sh", "check-figure-labels.ts"]) {
    cpSync(path.join(SCRIPTS, f), path.join(repo, "scripts", f));
  }
  cpSync(
    path.join(SCRIPTS, "lib", "check-figure-labels.py"),
    path.join(repo, "scripts", "lib", "check-figure-labels.py"),
  );
  cpSync(
    path.join(SCRIPTS, "lib", "sequence-matcher.ts"),
    path.join(repo, "scripts", "lib", "sequence-matcher.ts"),
  );
  cpSync(path.join(SCRIPTS, "lib", "governance"), path.join(repo, "scripts", "lib", "governance"), {
    recursive: true,
  });
});
after(() => rmSync(repo, { recursive: true, force: true }));

describe("check-figure-labels", () => {
  it("passes when labels appear in order", () => {
    const r = both([
      {
        name: "a/flow",
        prompt: box("Claude Code", "Gemini CLI"),
        words: [at("Claude", 10), at("Code", 70), at("Gemini", 500), at("CLI", 560)],
      },
    ]);
    assert.equal(r.status, 0);
    assert.equal(
      r.stdout,
      [
        "Checking docs/assets/a/flow.png (2 expected labels)...",
        "  ✓ [PASS] Label: 'Claude Code'",
        "  ✓ [PASS] Label: 'Gemini CLI'",
        "  RESULT: PASS for docs/assets/a/flow.png",
        "",
        "[PASS] All 1 figure(s) passed label OCR verification.",
        "",
      ].join("\n"),
    );
  });

  it("fails on a missing label", () => {
    const r = both([
      { name: "m", prompt: box("Alpha", "Zebra Crossing"), words: [at("Alpha", 10)] },
    ]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /❌ \[FAIL\] Missing label: 'Zebra Crossing'/);
    assert.match(r.stdout, /\[FAIL\] 1\/1 figure\(s\) failed label OCR verification\.\n$/);
  });

  it("fails on an out-of-order label", () => {
    const r = both([
      { name: "o", prompt: box("Right", "Left"), words: [at("Left", 10), at("Right", 500)] },
    ]);
    assert.equal(r.status, 1);
    assert.match(
      r.stdout,
      /❌ \[FAIL\] Label out of order: 'Left' found at cluster 0 \(x=10px\), expected after cluster 1/,
    );
  });

  it("warns when the sidecar yields no labels", () => {
    const r = both([{ name: "n", prompt: "no quoted text here\n", words: [at("x", 1)] }]);
    assert.equal(r.status, 0);
    assert.match(
      r.stdout,
      /  \[WARN\] No labels extracted from sidecar docs\/assets\/n\.prompt\.md\n/,
    );
  });

  it("falls back to numbered quoted lines", () => {
    const r = both([
      {
        name: "q",
        prompt: '1. "Alpha"\n  2. "Beta"\n"Gamma"  \n',
        words: [at("Alpha", 0), at("Beta", 300), at("Gamma", 700)],
      },
    ]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /\(3 expected labels\)/);
  });

  it("reports no sidecar and skips a sidecar without a PNG", () => {
    const none = both([]);
    assert.equal(none.stdout, "[INFO] No figure prompt sidecars found in docs/assets.\n");
    const lone = both([{ name: "lone", prompt: box("x"), noPng: true }]);
    assert.equal(lone.stdout, "[PASS] All 0 figure(s) passed label OCR verification.\n");
  });

  it("skips with a note when tesseract is absent", () => {
    setup([{ name: "s", prompt: box("x"), words: [at("x", 1)] }]).dispose();
    const absent = noTesseractEnv();
    try {
      const ts = runTs(absent.env);
      assert.equal(ts.status, 0);
      assert.equal(
        ts.stdout,
        "[SKIP] tesseract is not installed. Skipping figure label OCR check.\n",
      );
      if (shellOk) assert.deepEqual(runSh(absent.env), ts);
    } finally {
      absent.dispose();
    }
  });

  it("normalises Unicode punctuation and letters", () => {
    const r = both([
      {
        name: "u",
        prompt: box("Café — naïve “quote”", "Жук большой", "Pre- fix"),
        words: [
          at("Café", 0),
          at("-", 60),
          at("naïve", 100),
          at("“quote”", 160),
          at("Жук", 400),
          at("большой", 460),
          at("Pre-fix", 800),
        ],
      },
    ]);
    assert.equal(r.status, 0, r.stdout);
  });

  it("applies the 0.75 word ratio and the 50 percent rule", () => {
    // wxyz/wxya = 0.75 (match); wxy/wxa = 0.667 (no match); one of two words passes, one of three fails.
    const r = both([
      { name: "r1", prompt: box("wxyz"), words: [at("wxya", 0)] },
      { name: "r2", prompt: box("wxy"), words: [at("wxa", 0)] },
      { name: "r3", prompt: box("tulip rose"), words: [at("tulip", 0)] },
      { name: "r4", prompt: box("tulip rose daisy"), words: [at("tulip", 0)] },
    ]);
    const verdicts = r.stdout.split("\n").filter((l) => l.startsWith("  RESULT"));
    assert.deepEqual(verdicts, [
      "  RESULT: PASS for docs/assets/r1.png",
      "  RESULT: FAIL for docs/assets/r2.png",
      "  RESULT: PASS for docs/assets/r3.png",
      "  RESULT: FAIL for docs/assets/r4.png",
    ]);
    assert.equal(r.status, 1);
  });

  it("flushes earlier lines then reports one Error line on a malformed TSV integer", () => {
    const bad = tsvOf([at("x", 1)]).replace("\t1\t10\t", "\tX\t10\t");
    const standIn = setup([
      { name: "a", prompt: box("Alpha"), words: [at("Alpha", 0)] },
      { name: "b", prompt: box("Beta"), words: [at("Beta", 0)] },
    ]);
    try {
      writeFileSync(path.join(standIn.binDir, "tsv", "b.png.tsv"), bad);
      const r = runTs(standIn.env());
      assert.equal(r.status, 1);
      assert.equal(
        r.stdout,
        [
          "Checking docs/assets/a.png (1 expected labels)...",
          "  ✓ [PASS] Label: 'Alpha'",
          "  RESULT: PASS for docs/assets/a.png",
          "",
        ].join("\n") + "\n",
      );
      assert.equal(r.stderr, "Error: docs/assets/b.png: invalid literal for int(): 'X'\n");
    } finally {
      standIn.dispose();
    }
  });

  it("reports an Error line on invalid UTF-8 in the tesseract output", () => {
    const standIn = setup([{ name: "u8", prompt: box("Alpha"), words: [at("Alpha", 0)] }]);
    try {
      const good = Buffer.from(tsvOf([at("Alpha", 0)]));
      writeFileSync(
        path.join(standIn.binDir, "tsv", "u8.png.tsv"),
        Buffer.concat([good, Buffer.from([0xff, 0x0a])]),
      );
      const r = runTs(standIn.env());
      assert.equal(r.status, 1);
      assert.equal(r.stdout, "");
      assert.equal(r.stderr, "Error: docs/assets/u8.png: tesseract output is not valid UTF-8\n");
    } finally {
      standIn.dispose();
    }
  });
});

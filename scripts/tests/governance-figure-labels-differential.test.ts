// Differential test of the `figure-labels` group (spec 0259 R17, R26): the check through the
// shell-versus-TypeScript tee on the real repository and on the Bash suite (with and without
// tesseract on PATH), plus a leg where a stand-in `tesseract` serves scripted TSV to BOTH
// implementations on fixture sidecars created inside the sandbox.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it, test } from "node:test";
import { REPO } from "./lib/build-fixture-tree.ts";
import {
  casesOf,
  checkNeeds,
  hasTool,
  runRealRepo,
  runSuiteThroughTee,
  type Transcript,
} from "./lib/governance-differential.ts";
import { installTee, makeSandbox, runScript } from "./lib/governance-sandbox.ts";
import {
  installTesseractStandIn,
  noTesseractEnv,
  tsvOf,
  type OcrWord,
} from "./lib/tesseract-standin.ts";

const NAME = "check-figure-labels";
const SKIP_LINE = "[SKIP] tesseract is not installed. Skipping figure label OCR check.\n";
const WIN = process.platform === "win32";

function guard(): string | false {
  if (WIN) return "the tee needs bash";
  if (!fs.existsSync(path.join(REPO, "scripts", `${NAME}.ts`)))
    return "TypeScript twin not present";
  const missing = ["python3", "bash"].filter((t) => !hasTool(t));
  if (missing.length > 0) {
    if (process.env["CI"]) throw new Error(`CI is set but the host lacks ${missing.join(", ")}`);
    return `host lacks ${missing.join(", ")}`;
  }
  return false;
}
const skip = guard();

for (const c of casesOf("figure-labels")) {
  const missing = checkNeeds(c);
  const why =
    skip !== false ? skip : missing.length > 0 ? `host lacks ${missing.join(", ")}` : false;
  test(`${c.name}: real repository through the tee`, { skip: why }, () => {
    const t = runRealRepo(c);
    assert.notEqual(t.status, 99);
    assert.equal(t.status, 0, `${t.stdout}${t.stderr}`);
  });
  test(
    `${c.name}: unchanged Bash suite through the tee`,
    { skip: c.suite === null ? "no Bash suite" : why },
    () => {
      runSuiteThroughTee(c);
    },
  );
}

interface Figure {
  name: string;
  prompt: string;
  words: OcrWord[];
}

const box = (...labels: string[]): string => labels.map((l) => `Box text: "${l}"\n`).join("");
const at = (text: string, left: number, top = 10): OcrWord => ({ text, left, top });

/** Fixture sidecars and PNGs written into the sandbox (the sandbox copies tracked files only). */
function layOut(root: string, figures: readonly Figure[]): Record<string, string> {
  fs.rmSync(path.join(root, "docs", "assets"), { recursive: true, force: true });
  const tsv: Record<string, string> = {};
  for (const f of figures) {
    const base = path.join(root, "docs", "assets", f.name);
    fs.mkdirSync(path.dirname(base), { recursive: true });
    fs.writeFileSync(`${base}.prompt.md`, f.prompt);
    fs.writeFileSync(`${base}.png`, "png");
    tsv[`${path.basename(f.name)}.png`] = tsvOf(f.words);
  }
  return tsv;
}

function refuse(t: Transcript): Transcript {
  assert.ok(
    t.status !== 99 && !t.stderr.includes("governance-tee: DIVERGENCE"),
    `tee divergence (exit ${t.status})\n${t.stderr}${t.stdout}`,
  );
  return t;
}

/** Run the check through the tee on fixture figures with the stand-in tesseract on PATH. */
function withStandIn(figures: readonly Figure[]): Transcript {
  const sandbox = makeSandbox();
  let standIn: ReturnType<typeof installTesseractStandIn> | undefined;
  try {
    standIn = installTesseractStandIn(layOut(sandbox.root, figures));
    installTee(sandbox, NAME);
    const r = runScript(sandbox, NAME, { env: standIn.env(sandbox.env) });
    return refuse({ status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr });
  } finally {
    standIn?.dispose();
    sandbox.dispose();
  }
}

describe("check-figure-labels: stand-in tesseract through the tee", { skip }, () => {
  it("passes when every label is present, in order", () => {
    const t = withStandIn([
      {
        name: "a/flow",
        prompt: box("Claude Code", "Gemini CLI"),
        words: [at("Claude", 10), at("Code", 70), at("Gemini", 500), at("CLI", 560)],
      },
    ]);
    assert.equal(t.status, 0, t.stdout);
    assert.match(t.stdout, /\[PASS\] All 1 figure\(s\) passed/);
  });

  it("fails on a missing label", () => {
    const t = withStandIn([
      { name: "m", prompt: box("Alpha", "Zebra Crossing"), words: [at("Alpha", 10)] },
    ]);
    assert.equal(t.status, 1);
    assert.match(t.stdout, /\[FAIL\] Missing label: 'Zebra Crossing'/);
  });

  it("fails on an out-of-order label", () => {
    const t = withStandIn([
      { name: "o", prompt: box("Right", "Left"), words: [at("Left", 10), at("Right", 500)] },
    ]);
    assert.equal(t.status, 1);
    assert.match(t.stdout, /Label out of order: 'Left'/);
  });

  it("warns when no label can be extracted", () => {
    const t = withStandIn([{ name: "n", prompt: "nothing quoted\n", words: [at("x", 1)] }]);
    assert.equal(t.status, 0);
    assert.match(t.stdout, /\[WARN\] No labels extracted from sidecar docs\/assets\/n\.prompt\.md/);
  });

  it("normalises Unicode text", () => {
    const t = withStandIn([
      {
        name: "u",
        prompt: box("Café — naïve “quote”", "Жук большой"),
        words: [
          at("Café", 0),
          at("-", 60),
          at("naïve", 100),
          at("“quote”", 160),
          at("Жук", 400),
          at("большой", 460),
        ],
      },
    ]);
    assert.equal(t.status, 0, t.stdout);
  });

  it("applies the 0.75 word ratio and the 50 percent rule", () => {
    const t = withStandIn([
      { name: "r1", prompt: box("wxyz"), words: [at("wxya", 0)] },
      { name: "r2", prompt: box("wxy"), words: [at("wxa", 0)] },
      { name: "r3", prompt: box("tulip rose"), words: [at("tulip", 0)] },
      { name: "r4", prompt: box("tulip rose daisy"), words: [at("tulip", 0)] },
    ]);
    const verdicts = t.stdout.split("\n").filter((l) => l.startsWith("  RESULT"));
    assert.deepEqual(verdicts, [
      "  RESULT: PASS for docs/assets/r1.png",
      "  RESULT: FAIL for docs/assets/r2.png",
      "  RESULT: PASS for docs/assets/r3.png",
      "  RESULT: FAIL for docs/assets/r4.png",
    ]);
  });
});

describe("check-figure-labels: without tesseract on PATH", { skip }, () => {
  it("prints the SKIP note from both implementations on the real repository", () => {
    const sandbox = makeSandbox();
    const bare = noTesseractEnv(["dirname", "python3", "bash", "node"], sandbox.env);
    try {
      installTee(sandbox, NAME);
      const r = runScript(sandbox, NAME, { env: bare.env });
      const t = refuse({ status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr });
      assert.equal(t.status, 0, `${t.stdout}${t.stderr}`);
      assert.equal(t.stdout, SKIP_LINE);
    } finally {
      bare.dispose();
      sandbox.dispose();
    }
  });
});

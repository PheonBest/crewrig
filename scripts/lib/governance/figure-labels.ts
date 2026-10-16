// figure-labels.ts — figure label OCR check, the twin of scripts/check-figure-labels.sh
// and scripts/lib/check-figure-labels.py (spec 0156 / issue #881, spec 0259 requirement 17).
//
// Usage: const out = checkFigureLabels(repoRoot);   // out.lines, out.code
//        tesseractAvailable()                         // probe by spawning `tesseract --version`
// Sidecars are docs/assets/**/*.prompt.md in sorted path order (hidden directories and
// dot-files skipped, like Python glob); the PNG is the sidecar minus `.prompt.md` plus `.png`.
// Reuses findFiles (walk.ts), parseTesseractTsv (tesseract-tsv.ts), buildClusters and
// matchLabel (figure-cluster.ts).
// Exit codes: 0 pass, SKIP or no sidecar; 1 at least one figure failed.
// Output: the shell's lines byte for byte; paths use forward slashes.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { buildClusters, matchLabel, type Cluster } from "./figure-cluster.ts";
import { parseTesseractTsv } from "./tesseract-tsv.ts";
import { findFiles } from "./walk.ts";

export const SKIP_NOTE = "[SKIP] tesseract is not installed. Skipping figure label OCR check.";

export interface Outcome {
  lines: string[];
  code: number;
}

/** True unless spawning `tesseract` fails because it does not exist or cannot run. */
export function tesseractAvailable(): boolean {
  const res = spawnSync("tesseract", ["--version"], { stdio: "ignore" });
  const code = (res.error as NodeJS.ErrnoException | undefined)?.code;
  return code !== "ENOENT" && code !== "EACCES";
}

// Python `\s` / `\d`; Python `^` and `$` in MULTILINE mode only know "\n".
const WS =
  "\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const BOX = new RegExp(`Box text:[${WS}]*"([^"]+)"`, "gu");
const QUOTED = new RegExp(
  `(?<=^|\\n)[${WS}]*(?:\\p{Nd}+\\.[${WS}]*)?"([^"]+)"[${WS}]*(?=\\n|$)`,
  "gu",
);

/** Labels of a sidecar: every `Box text: "..."`, else the numbered or bare quoted lines. */
export function extractLabels(content: string): string[] {
  const box = [...content.matchAll(BOX)].map((m) => m[1] as string);
  if (box.length > 0) return box;
  return [...content.matchAll(QUOTED)].map((m) => m[1] as string);
}

function clustersOf(png: string): Cluster[] {
  const res = spawnSync("tesseract", [png, "stdout", "tsv"], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (res.error !== undefined || res.status !== 0) return [];
  return buildClusters(parseTesseractTsv(res.stdout));
}

function isSidecar(rel: string): boolean {
  return rel.endsWith(".prompt.md") && rel.split("/").every((seg) => !seg.startsWith("."));
}

function checkFigure(sidecar: string, png: string, root: string, lines: string[]): boolean {
  const relPng = path.relative(root, png).split(path.sep).join("/");
  const labels = extractLabels(readFileSync(sidecar, "utf8"));
  const clusters = clustersOf(png);
  const full = clusters.map((c) => c.raw).join(" ");
  lines.push(`Checking ${relPng} (${labels.length} expected labels)...`);
  if (labels.length === 0) {
    const relSidecar = path.relative(root, sidecar).split(path.sep).join("/");
    lines.push(`  [WARN] No labels extracted from sidecar ${relSidecar}`);
    return true;
  }
  let last = -1;
  let figureOk = true;
  for (const label of labels) {
    const hit = matchLabel(label, clusters, full);
    if (hit === null) {
      lines.push(`  ❌ [FAIL] Missing label: '${label}'`);
      figureOk = false;
    } else if (hit.index < last) {
      lines.push(
        `  ❌ [FAIL] Label out of order: '${label}' found at cluster ${hit.index} (x=${hit.left}px), expected after cluster ${last}`,
      );
      figureOk = false;
    } else {
      lines.push(`  ✓ [PASS] Label: '${label}'`);
      last = hit.index;
    }
  }
  lines.push(`  RESULT: ${figureOk ? "PASS" : "FAIL"} for ${relPng}`, "");
  return figureOk;
}

/** Run the check over `<root>/docs/assets`; assumes tesseract is available. */
export function checkFigureLabels(root: string): Outcome {
  const assets = path.join(root, "docs", "assets");
  const sidecars = existsSync(assets) ? findFiles(assets, isSidecar) : [];
  if (sidecars.length === 0) {
    return { lines: ["[INFO] No figure prompt sidecars found in docs/assets."], code: 0 };
  }
  const lines: string[] = [];
  let total = 0;
  let failed = 0;
  for (const rel of sidecars) {
    const sidecar = path.join(assets, rel);
    const png = `${sidecar.slice(0, -".prompt.md".length)}.png`;
    if (!existsSync(png)) continue;
    total += 1;
    if (!checkFigure(sidecar, png, root, lines)) failed += 1;
  }
  if (failed > 0) {
    lines.push(`[FAIL] ${failed}/${total} figure(s) failed label OCR verification.`);
    return { lines, code: 1 };
  }
  lines.push(`[PASS] All ${total} figure(s) passed label OCR verification.`);
  return { lines, code: 0 };
}

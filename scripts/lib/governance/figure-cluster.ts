// figure-cluster.ts — OCR word clustering, normalisation and label matching, the twin of
// `normalize`, `get_clusters`, `is_word_matched` and `match_label*` in
// scripts/lib/check-figure-labels.py (spec 0259 requirement 17).
//
// Usage: const clusters = buildClusters(parseTesseractTsv(tsv));
//        const hit = matchLabel("Claude Code", clusters, fullText);
// Reuses `ratio` (scripts/lib/sequence-matcher.ts) and `TsvWord`/`pyStrip` semantics from
// tesseract-tsv.ts. Python text rules: `\s` is the Unicode whitespace set, `\w` is
// letters, numbers and underscore, lengths count code points.
// Exit codes: not applicable (library). Finding-line format: not applicable.

import { ratio } from "../sequence-matcher.ts";
import type { TsvWord } from "./tesseract-tsv.ts";

export interface Cluster {
  left: number;
  top: number;
  /** Words joined by a single space, in reading order. */
  raw: string;
}

export interface LabelHit {
  index: number;
  left: number;
  top: number;
}

// Python `str.isspace()` characters, as the body of a character class.
const WS =
  "\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const HYPHEN_SPACE = new RegExp(`-[${WS}]+`, "gu");
const NON_WORD = new RegExp(`[^\\p{L}\\p{N}_${WS}-]`, "gu");
const SPACES = new RegExp(`[${WS}]+`, "gu");
const TRIM = / $|^ /g;

/** Python `normalize`: fold typography, drop punctuation, collapse spaces, lowercase. */
export function normalize(text: string): string {
  const folded = text
    .replaceAll("’", "'")
    .replaceAll("“", '"')
    .replaceAll("”", '"')
    .replaceAll("—", "-")
    .replaceAll("–", "-");
  return folded
    .replace(HYPHEN_SPACE, "-")
    .replace(NON_WORD, " ")
    .replace(SPACES, " ")
    .replace(TRIM, "")
    .toLowerCase();
}

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
  words: TsvWord[];
}

/** First-fit merge of x-sorted words within a 40px gap, then reading-order text per cluster. */
export function buildClusters(words: readonly TsvWord[]): Cluster[] {
  const byX = [...words].sort((a, b) => a.left - b.left);
  const boxes: Box[] = [];
  for (const w of byX) {
    const hit = boxes.find((c) => !(w.right < c.left - 40 || w.left > c.right + 40));
    if (hit === undefined) {
      boxes.push({ left: w.left, right: w.right, top: w.top, bottom: w.bottom, words: [w] });
      continue;
    }
    hit.words.push(w);
    hit.left = Math.min(hit.left, w.left);
    hit.right = Math.max(hit.right, w.right);
    hit.top = Math.min(hit.top, w.top);
    hit.bottom = Math.max(hit.bottom, w.bottom);
  }
  boxes.sort((a, b) => a.left - b.left || a.top - b.top);
  return boxes.map((c) => {
    const ordered = [...c.words].sort(
      (a, b) => Math.floor(a.top / 20) - Math.floor(b.top / 20) || a.left - b.left,
    );
    return { left: c.left, top: c.top, raw: ordered.map((w) => w.text).join(" ") };
  });
}

function wordMatched(word: string, ocrWords: readonly string[]): boolean {
  return ocrWords.some((ow) => word === ow || ratio(word, ow) >= 0.75);
}

function matchInText(label: string, text: string): boolean {
  const normLabel = normalize(label);
  const normText = normalize(text);
  if (normText.includes(normLabel)) return true;
  const labelWords = normLabel.split(" ").filter((w) => [...w].length > 1);
  if (labelWords.length === 0) return false;
  const textWords = normText.split(" ").filter((w) => w !== "");
  const matched = labelWords.filter((lw) => wordMatched(lw, textWords)).length;
  return matched / labelWords.length >= 0.5;
}

/** First matching cluster, else the whole OCR stream as cluster 0 at (0, 0), else null. */
export function matchLabel(
  label: string,
  clusters: readonly Cluster[],
  fullText: string,
): LabelHit | null {
  for (const [index, c] of clusters.entries()) {
    if (matchInText(label, c.raw)) return { index, left: c.left, top: c.top };
  }
  return matchInText(label, fullText) ? { index: 0, left: 0, top: 0 } : null;
}

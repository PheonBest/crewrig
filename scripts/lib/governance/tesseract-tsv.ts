// tesseract-tsv.ts — parser of `tesseract <png> stdout tsv` output, the twin of
// the word-collection loop of `get_clusters` in scripts/lib/check-figure-labels.py.
//
// Usage: const words = parseTesseractTsv(stdoutText);
// Python `str.splitlines()` semantics, header (first line) skipped; a row is
// kept when it has >= 12 tab-separated columns, column 0 is "5" (word level)
// and column 11 is non-empty after a Python `str.strip()`. Geometry comes from
// columns 6-9 (left, top, width, height); a non-integer geometry cell throws,
// like Python `int()` raising ValueError. `text` keeps its raw (unstripped) form.
// Exit codes: not applicable (library). Finding-line format: not applicable.

export interface TsvWord {
  left: number;
  top: number;
  right: number;
  bottom: number;
  text: string;
}

// Python str.splitlines() line boundaries ("\r\n" counts once).
const LINE_BREAKS = new RegExp(String.raw`\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]`);
// Python str.isspace() characters.
const PY_SPACE = String.raw`\t\n\v\f\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000`;
const PY_STRIP = new RegExp(`^[${PY_SPACE}]+|[${PY_SPACE}]+$`, "g");

export function pySplitlines(text: string): string[] {
  const lines = text.split(LINE_BREAKS);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function pyStrip(text: string): string {
  return text.replace(PY_STRIP, "");
}

function pyInt(cell: string): number {
  const s = pyStrip(cell);
  if (!/^[+-]?\d+(?:_\d+)*$/.test(s)) {
    throw new Error(`invalid literal for int(): '${cell}'`);
  }
  return Number.parseInt(s.replaceAll("_", ""), 10);
}

export function parseTesseractTsv(stdout: string): TsvWord[] {
  const words: TsvWord[] = [];
  for (const line of pySplitlines(stdout).slice(1)) {
    const parts = line.split("\t");
    if (parts.length >= 12 && parts[0] === "5" && pyStrip(parts[11] as string) !== "") {
      const left = pyInt(parts[6] as string);
      const top = pyInt(parts[7] as string);
      const width = pyInt(parts[8] as string);
      const height = pyInt(parts[9] as string);
      words.push({
        left,
        top,
        right: left + width,
        bottom: top + height,
        text: parts[11] as string,
      });
    }
  }
  return words;
}

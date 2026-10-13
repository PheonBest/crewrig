// check.ts — the checks that compare the generated manifest with the committed one: the orphan
// check (committed manifest → file) and the drift comparison with its line diff (spec 0257
// deviation (c): the shell shelled out to `diff -u`; the lines that differ are printed here with
// `-`/`+` prefixes and no headers).
//
// File → manifest drift is what the byte comparison catches: an absent published page changes
// the regenerated output.

import fs from "node:fs";

const PATH_ENTRY = /"path":[ \t\v\f\r]*"([^"\n]*)"/g;
// A quadratic table is fine for a manifest of hundreds of pages; past this a plain replace is shown.
const TABLE_LIMIT = 4_000_000;

export function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** One lint message per `"path"` entry of the committed manifest that is not a file. */
export function orphanErrors(repoRoot: string, indexText: string): string[] {
  const errors: string[] = [];
  for (const match of indexText.matchAll(PATH_ENTRY)) {
    const entryPath = match[1] ?? "";
    if (entryPath === "") continue;
    if (!isFile(`${repoRoot}/${entryPath}`)) {
      errors.push(`docs/index.json: entry path '${entryPath}' does not resolve to a file (orphan)`);
    }
  }
  return errors;
}

/** True when the committed bytes are not exactly the generated text. */
export function isStale(committed: Buffer, generated: string): boolean {
  return !committed.equals(Buffer.from(generated));
}

function lines(text: string): string[] {
  const parts = text.split("\n");
  if (parts[parts.length - 1] === "") parts.pop();
  return parts;
}

/** The differing lines between two texts: `-<line>` from `before`, `+<line>` from `after`. */
export function lineDiff(before: string, after: string): string[] {
  const a = lines(before);
  const b = lines(after);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++;
  }
  const mid = (list: string[]): string[] => list.slice(head, list.length - tail);
  const x = mid(a);
  const y = mid(b);
  if ((x.length + 1) * (y.length + 1) > TABLE_LIMIT) {
    return [...x.map((l) => `-${l}`), ...y.map((l) => `+${l}`)];
  }

  // Longest common subsequence of the differing middle, filled from the end.
  const width = y.length + 1;
  const table = new Uint32Array((x.length + 1) * width);
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) {
      table[i * width + j] =
        x[i] === y[j]
          ? (table[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0);
    }
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      i++;
      j++;
    } else if (
      j >= y.length ||
      (i < x.length && (table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0))
    ) {
      out.push(`-${x[i] ?? ""}`);
      i++;
    } else {
      out.push(`+${y[j] ?? ""}`);
      j++;
    }
  }
  return out;
}

// sequence-matcher.ts — twin of Python `difflib.SequenceMatcher(None, a, b).ratio()`.
//
// Usage: const r = ratio("abcd", "bcde"); // 0.75
// Ratcliff/Obershelp matching as in CPython: `findLongestMatch` keeps the
// earliest block in `a`, then the earliest in `b`, among the longest; blocks
// are found recursively left and right of it; ratio = 2 * M / T. Strings are
// compared by code point, like Python `str`. The autojunk popularity rule
// applies when `b` has 200 or more elements (no isjunk callback is modelled).
// Exit codes: not applicable (library). Finding-line format: not applicable.

type Block = [number, number, number];

/** Index lists of each element of `b`, minus the popular ones (autojunk). */
function buildB2j(b: readonly string[]): Map<string, number[]> {
  const b2j = new Map<string, number[]>();
  b.forEach((elt, j) => {
    const idxs = b2j.get(elt);
    if (idxs === undefined) b2j.set(elt, [j]);
    else idxs.push(j);
  });
  const n = b.length;
  if (n >= 200) {
    const ntest = Math.floor(n / 100) + 1;
    for (const [elt, idxs] of [...b2j]) {
      if (idxs.length > ntest) b2j.delete(elt);
    }
  }
  return b2j;
}

function findLongestMatch(
  a: readonly string[],
  b: readonly string[],
  b2j: Map<string, number[]>,
  alo: number,
  ahi: number,
  blo: number,
  bhi: number,
): Block {
  let besti = alo;
  let bestj = blo;
  let bestsize = 0;
  let j2len = new Map<number, number>();
  for (let i = alo; i < ahi; i++) {
    const newj2len = new Map<number, number>();
    for (const j of b2j.get(a[i] as string) ?? []) {
      if (j < blo) continue;
      if (j >= bhi) break;
      const k = (j2len.get(j - 1) ?? 0) + 1;
      newj2len.set(j, k);
      if (k > bestsize) {
        besti = i - k + 1;
        bestj = j - k + 1;
        bestsize = k;
      }
    }
    j2len = newj2len;
  }
  // Extend over equal elements (popular ones included); no element is junk.
  while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) {
    besti--;
    bestj--;
    bestsize++;
  }
  while (
    besti + bestsize < ahi &&
    bestj + bestsize < bhi &&
    a[besti + bestsize] === b[bestj + bestsize]
  ) {
    bestsize++;
  }
  return [besti, bestj, bestsize];
}

/** Total size of the matching blocks of `a` against `b`. */
function matchedElements(a: readonly string[], b: readonly string[]): number {
  const b2j = buildB2j(b);
  const queue: [number, number, number, number][] = [[0, a.length, 0, b.length]];
  let total = 0;
  while (queue.length > 0) {
    const [alo, ahi, blo, bhi] = queue.pop() as [number, number, number, number];
    const [i, j, k] = findLongestMatch(a, b, b2j, alo, ahi, blo, bhi);
    if (k === 0) continue;
    total += k;
    if (alo < i && blo < j) queue.push([alo, i, blo, j]);
    if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
  }
  return total;
}

/** `difflib.SequenceMatcher(None, a, b).ratio()`; 1.0 when both are empty. */
export function ratio(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  const length = x.length + y.length;
  if (length === 0) return 1.0;
  return (2.0 * matchedElements(x, y)) / length;
}

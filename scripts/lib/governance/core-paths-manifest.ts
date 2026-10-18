// core-paths-manifest.ts — the `.crewrig/core-paths.txt` grammar and the
// `dir_is_governed` rule of scripts/check-core-paths.ts (spec 0259 req 12).
//
// Grammar (identical to the shell and to sync-from-upstream.ts): one entry per line,
// first whitespace field = path, second token = policy (default `strict`), blank and
// `#` lines skipped, one trailing carriage return tolerated. Whitespace is the C-locale
// set (space, \t, \n, \v, \f, \r), never the wider JavaScript `\s`.
//
// Usage: parseManifest(text); isGoverned(entries, dir).
// Exit codes: not applicable (library).
// Finding-line format: not applicable.

export interface ManifestEntry {
  path: string;
  policy: string;
}

const WS = " \t\n\v\f\r";

/** Split manifest text into entries, as the shell's `while read -r` loop does. */
export function parseManifest(text: string): ManifestEntry[] {
  const lines = text.split("\n");
  // `read` yields no line for the empty remainder after a final newline.
  if (lines[lines.length - 1] === "") lines.pop();
  const entries: ManifestEntry[] = [];
  for (let line of lines) {
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (line === "" || line.startsWith("#")) continue;
    let end = 0;
    while (end < line.length && !WS.includes(line[end] as string)) end += 1;
    const path = line.slice(0, end);
    let start = end;
    while (start < line.length && WS.includes(line[start] as string)) start += 1;
    let stop = start;
    while (stop < line.length && !WS.includes(line[stop] as string)) stop += 1;
    const policy = line.slice(start, stop);
    entries.push({ path, policy: policy === "" ? "strict" : policy });
  }
  return entries;
}

const GOVERNING = new Set(["strict", "adopt-on-edit", "regenerable"]);

function covers(gov: string, dir: string): boolean {
  return dir === gov || dir.startsWith(`${gov}/`);
}

/**
 * Governed iff some strict/adopt-on-edit/regenerable entry covers `dir` with no
 * `excluded` entry nested strictly under THAT entry covering it. An excluded match
 * skips the governing entry and the scan continues (never concludes).
 */
export function isGoverned(entries: readonly ManifestEntry[], dir: string): boolean {
  for (const g of entries) {
    if (!GOVERNING.has(g.policy) || !covers(g.path, dir)) continue;
    const skipped = entries.some(
      (x) => x.policy === "excluded" && x.path.startsWith(`${g.path}/`) && covers(x.path, dir),
    );
    if (!skipped) return true;
  }
  return false;
}

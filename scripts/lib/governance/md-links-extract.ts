// md-links-extract.ts — the Python text rules of scripts/check-markdown-links.sh,
// reproduced exactly (spec 0259 requirement 16). Pure functions, no I/O.
//
// Usage: splitLines(decodeIgnore(bytes)) then, per line, linkTargets(...) and
// resolveTarget(target, dirnamePy(file)).
// Exit codes: not applicable (library).
// Finding-line format: not applicable (built by md-links.ts).
//
// Python rules covered: universal newlines, the str.strip()/\s whitespace set,
// utf-8 decoding with errors="ignore", urllib.parse.unquote (utf-8, replace, per
// ASCII run), os.path.normpath/join/dirname (POSIX), and re.I folding for the
// scheme test (Python also folds U+017F, U+0131 and U+0130 onto ASCII letters).

/** Characters for which Python's str.isspace() (and regex \s) is true. */
export const PY_WS =
  "\\t\\n\\u000b\\f\\r\\u001c-\\u001f \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";

const LINK_RE = new RegExp(`\\]\\(([^)${PY_WS}]+|<[^>]+>)\\)`, "g");
const STRIP_RE = new RegExp(`^[${PY_WS}]+|[${PY_WS}]+$`, "g");
const INLINE_CODE_RE = /`[^`]+`/g;
const SCHEME_RE = /^(https?|mailto|ftp):/;
const ISSUE_RE = /\.\.\/[^\n]*(issues|pull)\/[0-9]+/;
const DECODER = new TextDecoder("utf-8", { ignoreBOM: true });
const STRICT = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** Python's str.strip() with no argument. */
export function pyStrip(s: string): string {
  return s.replace(STRIP_RE, "");
}

/** Python's str.strip("<>"). */
export function stripAngles(s: string): string {
  let a = 0;
  let b = s.length;
  while (a < b && (s[a] === "<" || s[a] === ">")) a++;
  while (b > a && (s[b - 1] === "<" || s[b - 1] === ">")) b--;
  return s.slice(a, b);
}

/** Length of the valid UTF-8 prefix at `i`, or the invalid-subpart length (negative). */
function sequenceAt(b: Uint8Array, i: number): number {
  const c = b[i] as number;
  if (c < 0x80) return 1;
  let need: number;
  let lo = 0x80;
  let hi = 0xbf;
  if (c >= 0xc2 && c <= 0xdf) need = 1;
  else if (c >= 0xe0 && c <= 0xef) {
    need = 2;
    if (c === 0xe0) lo = 0xa0;
    if (c === 0xed) hi = 0x9f;
  } else if (c >= 0xf0 && c <= 0xf4) {
    need = 3;
    if (c === 0xf0) lo = 0x90;
    if (c === 0xf4) hi = 0x8f;
  } else return -1;
  for (let k = 1; k <= need; k++) {
    const d = b[i + k];
    if (d === undefined || d < lo || d > hi) return -k;
    lo = 0x80;
    hi = 0xbf;
  }
  return need + 1;
}

/** bytes.decode("utf-8", errors="ignore"): invalid subparts are dropped, a BOM is kept. */
export function decodeIgnore(buf: Uint8Array): string {
  try {
    return STRICT.decode(buf);
  } catch {
    // fall through to the slow path
  }
  const parts: string[] = [];
  let i = 0;
  let start = 0;
  while (i < buf.length) {
    const n = sequenceAt(buf, i);
    if (n > 0) {
      i += n;
      continue;
    }
    if (i > start) parts.push(DECODER.decode(buf.subarray(start, i)));
    i += -n;
    start = i;
  }
  if (i > start) parts.push(DECODER.decode(buf.subarray(start, i)));
  return parts.join("");
}

/** Text-mode readlines(): universal newlines, each line keeps its trailing "\n". */
export function splitLines(text: string): string[] {
  const t = text.replace(/\r\n?/g, "\n");
  const lines: string[] = [];
  let pos = 0;
  while (pos < t.length) {
    const nl = t.indexOf("\n", pos);
    const end = nl === -1 ? t.length : nl + 1;
    lines.push(t.slice(pos, end));
    pos = end;
  }
  return lines;
}

/** Link targets of one line, inline code removed first (raw group 1 of the pattern). */
export function linkTargets(line: string): string[] {
  const cleaned = line.replace(INLINE_CODE_RE, "");
  return Array.from(cleaned.matchAll(LINK_RE), (m) => m[1] as string);
}

function foldChar(c: string): string {
  if (c === "ſ") return "s";
  if (c === "ı" || c === "İ") return "i";
  const l = c.toLowerCase();
  return l.length === 1 ? l : c;
}

/** re.match(r"^(https?|mailto|ftp):", target, re.I) with Python's folding. */
export function hasSkippedScheme(target: string): boolean {
  let head = "";
  for (const c of target.slice(0, 7)) head += foldChar(c);
  return SCHEME_RE.test(head);
}

/** urllib.parse.unquote(s): utf-8, errors="replace", decoded per ASCII run. */
export function unquotePy(s: string): string {
  if (!s.includes("%")) return s;
  return s.replace(/[\x00-\x7f]+/g, (run) => {
    if (!run.includes("%")) return run;
    const pieces = run.split("%");
    const chunks: Buffer[] = [Buffer.from(pieces[0] as string, "latin1")];
    for (const item of pieces.slice(1)) {
      if (/^[0-9a-fA-F]{2}/.test(item)) {
        chunks.push(Buffer.from([Number.parseInt(item.slice(0, 2), 16)]));
        chunks.push(Buffer.from(item.slice(2), "latin1"));
      } else chunks.push(Buffer.from(`%${item}`, "latin1"));
    }
    return DECODER.decode(Buffer.concat(chunks));
  });
}

/** posixpath.dirname. */
export function dirnamePy(p: string): string {
  const i = p.lastIndexOf("/") + 1;
  let head = p.slice(0, i);
  if (head !== "" && head !== "/".repeat(head.length)) head = head.replace(/\/+$/, "");
  return head;
}

/** posixpath.join(a, b). */
export function joinPy(a: string, b: string): string {
  if (b.startsWith("/")) return b;
  if (a === "" || a.endsWith("/")) return a + b;
  return `${a}/${b}`;
}

/** posixpath.normpath (a leading "//" is kept, three or more slashes collapse). */
export function normpathPy(p: string): string {
  if (p === "") return ".";
  let initial = p.startsWith("/") ? 1 : 0;
  if (initial === 1 && p.startsWith("//") && !p.startsWith("///")) initial = 2;
  const out: string[] = [];
  for (const comp of p.split("/")) {
    if (comp === "" || comp === ".") continue;
    const last = out[out.length - 1];
    if (comp !== ".." || (initial === 0 && out.length === 0) || last === "..") out.push(comp);
    else if (out.length > 0) out.pop();
  }
  return "/".repeat(initial) + out.join("/") || ".";
}

/**
 * Apply the skip rules and resolve one raw target. Returns null when the link is
 * skipped, else the normalised path to test for existence.
 */
export function resolveTarget(raw: string, fileDir: string): string | null {
  const target = stripAngles(raw);
  if (hasSkippedScheme(target)) return null;
  if (target.startsWith("#")) return null;
  if (target.includes("${") || target.includes("{{") || target.includes("$CANONICAL_REPO"))
    return null;
  if (ISSUE_RE.test(target)) return null;
  const clean = target.split("#")[0] as string;
  if (clean === "") return null;
  return normpathPy(joinPy(fileDir, unquotePy(clean)));
}

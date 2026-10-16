// toml_subset.ts — reader of the TOML subset the end-to-end harness uses (spec 0261 R6).
//
// Accepted: table headers `[a.b]` (bare keys), `key = value` with bare keys, basic strings with
// the TOML basic escapes, literal strings, booleans, integers, floats, arrays of scalars across
// several lines (comments between elements, trailing comma), `#` comments, LF or CRLF.
// Refused, with a one-line diagnostic `<file>:<line>: unsupported construct: <name>`: dates and
// times, multi-line strings, inline tables, arrays of tables, dotted keys, quoted keys, nested
// arrays, inf and nan. A key given twice in one table keeps its last value and a table header
// that reopens a table continues it, as the shell's yq reader did (recorded goldens).

export interface TomlNumber {
  /** The JSON text of the number: integers in decimal, floats as the shortest float64 text. */
  readonly num: string;
}
export type TomlValue = string | boolean | TomlNumber | TomlValue[] | TomlTable;
export type TomlTable = Map<string, TomlValue>;

export class TomlError extends Error {
  readonly file: string;
  readonly line: number;
  constructor(file: string, line: number, message: string) {
    super(`${file}:${line}: ${message}`);
    this.file = file;
    this.line = line;
  }
}

export const isTable = (v: TomlValue): v is TomlTable => v instanceof Map;
export const isNumber = (v: TomlValue): v is TomlNumber =>
  typeof v === "object" && !Array.isArray(v) && !(v instanceof Map);

const BARE = /^[A-Za-z0-9_-]+/;
const INT = /^[+-]?(0|[1-9](_?\d)*)$/;
const FLOAT = /^[+-]?(0|[1-9](_?\d)*)(\.\d(_?\d)*)?([eE][+-]?\d(_?\d)*)?$/;
const RADIX = /^0([xob])([0-9A-Fa-f](_?[0-9A-Fa-f])*)$/;
const ESCAPES: Record<string, string> = {
  b: "\b",
  t: "\t",
  n: "\n",
  f: "\f",
  r: "\r",
  '"': '"',
  "\\": "\\",
};

class Reader {
  readonly lines: string[];
  readonly file: string;
  ln = 0;
  col = 0;
  constructor(text: string, file: string) {
    this.file = file;
    this.lines = text.replace(/^﻿/, "").split(/\r?\n/);
  }
  fail(message: string): never {
    throw new TomlError(this.file, this.ln + 1, message);
  }
  refuse(construct: string): never {
    this.fail(`unsupported construct: ${construct}`);
  }
  get rest(): string {
    return (this.lines[this.ln] ?? "").slice(this.col);
  }
  skipBlank(): void {
    const m = /^[ \t]*/.exec(this.rest);
    this.col += m === null ? 0 : m[0].length;
  }
  /** Skip blanks, comments and line ends (inside an array). Returns false at end of input. */
  skipSpace(): boolean {
    for (;;) {
      this.skipBlank();
      if (this.rest === "" || this.rest.startsWith("#")) {
        if (this.ln + 1 >= this.lines.length) return false;
        this.ln += 1;
        this.col = 0;
      } else return true;
    }
  }
  endOfLine(): void {
    this.skipBlank();
    if (this.rest !== "" && !this.rest.startsWith("#"))
      this.fail(`syntax error near '${this.rest}'`);
  }
  key(): string {
    const m = BARE.exec(this.rest);
    if (m === null) {
      if (/^["']/.test(this.rest)) this.refuse("quoted key");
      this.fail(`syntax error: expected a key near '${this.rest}'`);
    }
    this.col += m[0].length;
    return m[0];
  }
  basicString(): string {
    let out = "";
    let i = 1;
    const s = this.rest;
    for (;;) {
      const c = s[i];
      if (c === undefined) this.fail("syntax error: unterminated string");
      if (c === '"') break;
      if (c === "\\") {
        const e = s[i + 1] ?? "";
        const hex = e === "u" ? 4 : e === "U" ? 8 : 0;
        if (hex > 0) {
          const h = s.slice(i + 2, i + 2 + hex);
          const cp = Number.parseInt(h, 16);
          if (
            h.length !== hex ||
            !/^[0-9A-Fa-f]+$/.test(h) ||
            cp > 0x10ffff ||
            (cp >= 0xd800 && cp < 0xe000)
          )
            this.fail("syntax error: bad unicode escape");
          out += String.fromCodePoint(cp);
          i += 2 + hex;
        } else if (ESCAPES[e] !== undefined) {
          out += ESCAPES[e];
          i += 2;
        } else this.fail(`syntax error: bad escape '\\${e}'`);
      } else {
        const cp = c.codePointAt(0) ?? 0;
        if ((cp < 0x20 && c !== "\t") || cp === 0x7f)
          this.fail("syntax error: control character in string");
        out += c;
        i += 1;
      }
    }
    this.col += i + 1;
    return out;
  }
  value(inArray: boolean): TomlValue {
    const s = this.rest;
    if (s.startsWith('"""') || s.startsWith("'''")) this.refuse("multi-line string");
    if (s.startsWith('"')) return this.basicString();
    if (s.startsWith("'")) {
      const end = s.indexOf("'", 1);
      if (end < 0) this.fail("syntax error: unterminated string");
      this.col += end + 1;
      return s.slice(1, end);
    }
    if (s.startsWith("{")) this.refuse("inline table");
    if (s.startsWith("[")) {
      if (inArray) this.refuse("nested array");
      return this.array();
    }
    const tok = /^[^\s,\]#]*/.exec(s)?.[0] ?? "";
    if (tok === "") this.fail(`syntax error: expected a value near '${s}'`);
    this.col += tok.length;
    return this.scalar(tok);
  }
  scalar(tok: string): TomlValue {
    if (tok === "true") return true;
    if (tok === "false") return false;
    if (/^\d{4}-\d{2}-\d{2}/.test(tok) || /^\d{2}:\d{2}/.test(tok)) this.refuse("date or time");
    if (/^[+-]?(inf|nan)$/.test(tok)) this.refuse("special float (inf, nan)");
    const radix = RADIX.exec(tok);
    if (radix !== null) {
      const prefix = { x: "0x", o: "0o", b: "0b" }[radix[1] ?? "x"];
      try {
        return { num: BigInt(prefix + (radix[2] ?? "").replaceAll("_", "")).toString() };
      } catch {
        this.fail(`syntax error: bad integer '${tok}'`);
      }
    }
    if (INT.test(tok))
      return { num: BigInt(tok.replaceAll("_", "").replace(/^\+/, "")).toString() };
    if (FLOAT.test(tok)) {
      const n = Number(tok.replaceAll("_", ""));
      if (!Number.isFinite(n)) this.fail(`syntax error: float out of range '${tok}'`);
      return { num: String(n) };
    }
    return this.fail(`syntax error: bad value '${tok}'`);
  }
  array(): TomlValue[] {
    const out: TomlValue[] = [];
    this.col += 1;
    for (;;) {
      if (!this.skipSpace()) this.fail("syntax error: unterminated array");
      if (this.rest.startsWith("]")) {
        this.col += 1;
        return out;
      }
      out.push(this.value(true));
      if (!this.skipSpace()) this.fail("syntax error: unterminated array");
      if (this.rest.startsWith(",")) this.col += 1;
      else if (!this.rest.startsWith("]")) this.fail(`syntax error near '${this.rest}'`);
    }
  }
}

function descend(r: Reader, from: TomlTable, path: readonly string[]): TomlTable {
  let cur = from;
  for (const k of path) {
    const next = cur.get(k);
    if (next === undefined) {
      const made: TomlTable = new Map();
      cur.set(k, made);
      cur = made;
    } else if (isTable(next)) cur = next;
    else r.fail(`syntax error: '${k}' is already defined as a value`);
  }
  return cur;
}

/** Read a document; throws a TomlError naming file, line and construct. */
export function parseToml(text: string, file: string): TomlTable {
  const r = new Reader(text, file);
  const root: TomlTable = new Map();
  let table = root;
  for (r.ln = 0; r.ln < r.lines.length; r.ln += 1) {
    r.col = 0;
    r.skipBlank();
    if (r.rest === "" || r.rest.startsWith("#")) continue;
    if (r.rest.startsWith("[[")) r.refuse("array of tables");
    if (r.rest.startsWith("[")) {
      r.col += 1;
      const path: string[] = [];
      for (;;) {
        r.skipBlank();
        path.push(r.key());
        r.skipBlank();
        if (r.rest.startsWith(".")) r.col += 1;
        else break;
      }
      if (!r.rest.startsWith("]")) r.fail("syntax error: expected character ]");
      r.col += 1;
      r.endOfLine();
      table = descend(r, root, path);
      continue;
    }
    const key = r.key();
    r.skipBlank();
    if (r.rest.startsWith(".")) r.refuse("dotted key");
    if (!r.rest.startsWith("=")) r.fail("syntax error: expected character =");
    r.col += 1;
    r.skipBlank();
    const v = r.value(false);
    r.endOfLine();
    table.set(key, v);
  }
  return root;
}

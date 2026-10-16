// ere.ts — POSIX ERE (`grep -E`) to JavaScript RegExp translator, shared by assert.ts and
// structural.ts (split out of assert.ts to honour the 300-line limit, spec 0238).

// ── POSIX ERE (`grep -E`) to JavaScript ───────────────────────────────────────────────────────
// Supported: literals, `. ^ $ * + ? {m,n} |`, groups, back-references, bracket expressions with
// POSIX classes, GNU `\w \W \s \S \b \B \< \>`. Refused (grep's exit 2, so no match): `[.x.]`,
// `[=x=]`, stacked quantifiers (`a**`). A backslash inside a bracket is literal, as in POSIX.

const CLASSES: Readonly<Record<string, string>> = {
  alpha: "a-zA-Z",
  digit: "0-9",
  alnum: "a-zA-Z0-9",
  upper: "A-Z",
  lower: "a-z",
  space: " \\t\\n\\v\\f\\r",
  blank: " \\t",
  punct: "!-\\/:-@\\[-`{-~",
  print: " -~",
  graph: "!-~",
  cntrl: "\\x00-\\x1f\\x7f",
  xdigit: "0-9A-Fa-f",
};
const SPECIAL = /[\\^$.*+?()[\]{}|/]/;
const lit = (c: string): string => (SPECIAL.test(c) ? `\\${c}` : c);

function bracket(src: string, start: number): { out: string; next: number } {
  let i = start + 1;
  let out = "[";
  if (src[i] === "^") {
    out += "^";
    i += 1;
  }
  let first = true;
  for (;;) {
    const c = src[i];
    if (c === undefined) throw new Error("unterminated bracket expression");
    if (c === "]" && !first) return { out: `${out}]`, next: i + 1 };
    first = false;
    if (c === "[" && (src[i + 1] === ":" || src[i + 1] === "." || src[i + 1] === "=")) {
      const close = src.indexOf(`${src[i + 1]}]`, i + 2);
      if (close < 0) throw new Error("unterminated class");
      const name = src.slice(i + 2, close);
      const body = src[i + 1] === ":" ? CLASSES[name] : undefined;
      if (body === undefined)
        throw new Error(`unsupported bracket construct [${src[i + 1]}${name}`);
      out += body;
      i = close + 2;
    } else {
      out += c === "\\" || c === "[" || c === "]" || c === "^" ? `\\${c}` : c;
      i += 1;
    }
  }
}

export function ereToRegExp(src: string): RegExp {
  let out = "";
  let atom = false; // the previous token can take a quantifier
  for (let i = 0; i < src.length;) {
    const c = src[i] as string;
    if (c === "\\") {
      const n = src[i + 1];
      if (n === undefined) throw new Error("trailing backslash");
      if ("wWsSbB".includes(n)) out += `\\${n}`;
      else if (n === "<") out += "\\b(?=\\w)";
      else if (n === ">") out += "\\b(?<=\\w)";
      else if (/[1-9]/.test(n)) out += `\\${n}`;
      else out += lit(n);
      atom = !"bB<>".includes(n);
      i += 2;
    } else if (c === "[") {
      const b = bracket(src, i);
      out += b.out;
      i = b.next;
      atom = true;
    } else if (c === "(" || c === "|") {
      out += c;
      i += 1;
      atom = false;
    } else if (c === ")") {
      out += c;
      i += 1;
      atom = true;
    } else if (c === "*" || c === "+" || c === "?") {
      if (!atom) out += `\\${c}`;
      else if (/[*+?]/.test(src[i + 1] ?? "")) throw new Error("stacked quantifiers");
      else out += c;
      i += 1;
    } else if (c === "{") {
      const m = /^\{(\d*)(,(\d*))?\}/.exec(src.slice(i));
      if (m !== null && atom && (m[1] !== "" || m[3] !== undefined)) {
        out += `{${m[1] === "" ? "0" : (m[1] ?? "")}${m[2] ?? ""}}`;
        i += m[0].length;
      } else {
        out += "\\{";
        i += 1;
      }
    } else if (c === "^" || c === "$") {
      out += c;
      i += 1;
      atom = false;
    } else if (c === ".") {
      out += "[\\s\\S]";
      i += 1;
      atom = true;
    } else {
      out += lit(c);
      i += 1;
      atom = true;
    }
  }
  return new RegExp(out);
}

/** `grep -E -q <ere>`: does any line of `text` match? An unusable pattern matches nothing (grep rc 2). */
export function ereMatches(ere: string, text: string): boolean {
  let re: RegExp;
  try {
    re = ereToRegExp(ere);
  } catch {
    return false;
  }
  if (text === "") return false;
  return text.split("\n").some((line) => re.test(line.endsWith("\r") ? line.slice(0, -1) : line));
}

// tokenize.ts — split a metadata payload into KEY=VALUE pairs (the shell's `parse_block`).
//
// Quirks kept on purpose: the key is the text before the first `=` of the WHOLE remaining string,
// even when that spans spaces; a quoted value runs to the next `"` (there is no escape); a bare
// value runs to the next whitespace; the value check precedes the key check; the first error wins.

export interface Block {
  readonly section: string | undefined;
  readonly navOrder: string | undefined;
  readonly published: string | undefined;
  readonly title: string | undefined;
}

export type ParseResult =
  | { readonly ok: true; readonly block: Block }
  | { readonly ok: false; readonly error: string };

const LEADING_WHITESPACE = /^[ \t\n\v\f\r]+/;
const FIRST_WHITESPACE = /[ \t\n\v\f\r]/;

export function parseBlock(payload: string, file: string): ParseResult {
  let section: string | undefined;
  let navOrder: string | undefined;
  let published: string | undefined;
  let title: string | undefined;
  const fail = (error: string): ParseResult => ({ ok: false, error: `${file}: ${error}` });

  let rest = payload;
  // The shell's guard strips only spaces, so a payload of tabs enters the loop and leaves at the
  // empty-string break: both exits are the same here.
  while (rest.replaceAll(" ", "") !== "") {
    rest = rest.replace(LEADING_WHITESPACE, "");
    if (rest === "") break;

    const eq = rest.indexOf("=");
    if (eq < 0) return fail(`malformed metadata token (no '='): '${rest}'`);
    const key = rest.slice(0, eq);
    rest = rest.slice(eq + 1);

    let value: string;
    if (rest.startsWith('"')) {
      rest = rest.slice(1);
      const close = rest.indexOf('"');
      if (close < 0) return fail(`unterminated quoted value for key '${key}'`);
      value = rest.slice(0, close);
      rest = rest.slice(close + 1);
    } else {
      const blank = FIRST_WHITESPACE.exec(rest);
      value = blank === null ? rest : rest.slice(0, blank.index);
      rest = rest.slice(value.length);
    }

    if (value.includes('"') || value.includes(">")) {
      return fail(`value for key '${key}' contains a forbidden '"' or '>' character`);
    }

    if (key === "section") section = value;
    else if (key === "nav_order") navOrder = value;
    else if (key === "published") published = value;
    else if (key === "title") title = value;
    else return fail(`unknown metadata key '${key}'`);
  }
  return { ok: true, block: { section, navOrder, published, title } };
}

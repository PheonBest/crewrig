// mask_command.ts — twin of tests/e2e/lib/mask_command.sh: mask value-bearing assignments in a
// harness command before it is embedded in a published verdict (spec 0194 v2-F3; spec 0261 R1-R4).

/** Boundary, optionally dash-prefixed identifier, `=`, then a quoted or unquoted value. */
const ASSIGNMENT =
  /(^|[ \t\n\r\f\v;&|("'])(-{0,2}[A-Za-z_][A-Za-z0-9_-]*)=("[^"]*"|'[^']*'|[^ \t\r\f\v]*)/g;

/** `e2e_mask_command_string`: the shell applied sed line by line, so `^` anchors every line. */
export function maskCommandString(raw: string): string {
  return raw
    .split("\n")
    .map((line) => line.replace(ASSIGNMENT, "$1$2=***"))
    .join("\n");
}

/**
 * `e2e_mask_command_json`: JSON array of strings in, JSON array out. Like the shell (`jq -r '.[]'`
 * read line by line), an element holding a newline becomes several elements.
 */
export function maskCommandJson(stdin: string): { rc: number; stdout: string; stderr: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdin);
  } catch (err) {
    return { rc: 0, stdout: "[]\n", stderr: `jq: error (parse): ${(err as Error).message}\n` };
  }
  const items = Array.isArray(parsed) ? parsed : [];
  const elements: string[] = [];
  for (const item of items) {
    const text = typeof item === "string" ? item : JSON.stringify(item);
    for (const line of text.split("\n")) elements.push(maskCommandString(line));
  }
  // jq escapes DEL as \u007f where JSON.stringify leaves it raw.
  const out = JSON.stringify(elements).replaceAll("\u007f", "\\u007f");
  return { rc: 0, stdout: `${out}\n`, stderr: "" };
}

/** Bash `printf %q`: backslash escaping, `$'...'` for control characters, `''` when empty. */
export function bashQuote(value: string): string {
  if (value === "") return "''";
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    const body = value.replace(/[\u0000-\u001f\u007f\\']/g, (c) => {
      const named: Record<string, string> = {
        "\n": "\\n",
        "\t": "\\t",
        "\r": "\\r",
        "\u0007": "\\a",
        "\b": "\\b",
        "\f": "\\f",
        "\v": "\\v",
        "\u001b": "\\E",
        "\\": "\\\\",
        "'": "\\'",
      };
      return named[c] ?? `\\${c.charCodeAt(0).toString(8).padStart(3, "0")}`;
    });
    return `$'${body}'`;
  }
  return value.replace(/[^A-Za-z0-9_\-.,:/@%+=~\u0080-￿]/g, "\\$&").replace(/^~/, "\\~");
}

/** Bash `printf %q` in the C locale the goldens were recorded under: every byte >= 0x80 is octal-escaped. */
const ANSI_C: Readonly<Record<number, string>> = {
  7: "\\a",
  8: "\\b",
  9: "\\t",
  10: "\\n",
  11: "\\v",
  12: "\\f",
  13: "\\r",
  27: "\\E",
  39: "\\'",
  92: "\\\\",
};

export function bashQuoteC(value: string): string {
  if (!/[^\u0000-\u007f]/.test(value)) return bashQuote(value);
  let body = "";
  for (const byte of Buffer.from(value, "utf8")) {
    if (byte >= 0x80 || (byte < 0x20 && ANSI_C[byte] === undefined) || byte === 0x7f) {
      body += `\\${byte.toString(8).padStart(3, "0")}`;
    } else body += ANSI_C[byte] ?? String.fromCharCode(byte);
  }
  return `$'${body}'`;
}

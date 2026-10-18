// render.ts — the exact JSON text of the shell's `emit_index`: two-space indentation, fixed key
// order, sections in taxonomy order and only when non-empty, rows by `nav_order` numerically then
// by path bytes, one trailing line feed, LF only. The output is deterministic so that re-running
// on an unchanged tree is byte-identical, which is what makes `--check` reliable.
//
// Rows are the tab-joined strings `lint.ts` produces; they are split here with the shell's
// parameter-expansion semantics, `sort -t<TAB> -k2,2n -k3,3` included (its last-resort whole-line
// comparison too).

import { SECTIONS } from "./sections.ts";

const TAB = "\t";

function jsonEscape(text: string): string {
  return text.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

/** UTF-8 byte order, which is what `sort` under LC_ALL=C gives (UTF-16 order differs for astral characters). */
export function compareBytes(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

function field(row: string, index: number): string {
  const parts = row.split(TAB);
  return parts[index] ?? "";
}

function compareRows(a: string, b: string): number {
  // BigInt keeps a very long `nav_order` exact where a float would round it.
  const na = BigInt(field(a, 1));
  const nb = BigInt(field(b, 1));
  if (na !== nb) return na < nb ? -1 : 1;
  return compareBytes(field(a, 2), field(b, 2)) || compareBytes(a, b);
}

function renderPage(row: string): string {
  let rest = row.slice(row.indexOf(TAB) + 1); // drop the section
  const nav = rest.includes(TAB) ? rest.slice(0, rest.indexOf(TAB)) : rest;
  rest = rest.slice(rest.indexOf(TAB) + 1); // drop nav_order
  const rowPath = rest.includes(TAB) ? rest.slice(0, rest.indexOf(TAB)) : rest;
  // `${rest#*TAB}` leaves the string unchanged when no tab remains.
  const title = rest.includes(TAB) ? rest.slice(rest.indexOf(TAB) + 1) : rest;
  return [
    "        {",
    `          "title": "${jsonEscape(title)}",`,
    `          "path": "${jsonEscape(rowPath)}",`,
    `          "nav_order": ${nav}`,
    "        }",
  ].join("\n");
}

/** The manifest text for the validated published rows. */
export function renderIndex(rows: readonly string[]): string {
  const blocks: string[] = [];
  for (const { key, title } of SECTIONS) {
    const own = rows.filter((row) => row.slice(0, row.indexOf(TAB)) === key);
    if (own.length === 0) continue;
    const pages = own.toSorted(compareRows).map(renderPage).join(",\n");
    blocks.push(
      [
        "    {",
        `      "section": "${jsonEscape(key)}",`,
        `      "title": "${jsonEscape(title)}",`,
        '      "pages": [',
        pages,
        "      ]",
        "    }",
      ].join("\n"),
    );
  }
  // An empty set keeps the shell's blank line between `[` and `]`.
  return `{\n  "version": 1,\n  "sections": [\n${blocks.join(",\n")}\n  ]\n}\n`;
}

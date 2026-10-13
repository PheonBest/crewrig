// extract.ts — pull the crewrig-doc payload out of a page (the shell's `extract_block`).
//
// The block is the first line containing `crewrig-doc:` AFTER the first `# ` heading; anchoring to
// the post-H1 position keeps an earlier illustrative line (the contract page's own examples) from
// being mis-parsed as the page's real block. Lines are split on LF only and a CR stays on the line,
// as awk saw it; the whitespace class below covers it exactly as `[[:space:]]` did. A leading
// byte-order mark is not stripped: it keeps `# ` from matching on the first line, as in awk.

const MARKER = "crewrig-doc:";
const WHITESPACE_RUN = /^[ \t\n\v\f\r]+/;
const TRAILING_WHITESPACE = /[ \t\n\v\f\r]+$/;

/** The text after the last marker on the line, cut at the first `-->` (and the blanks before it). */
function payloadOf(line: string): string {
  const afterMarker = line.slice(line.lastIndexOf(MARKER) + MARKER.length);
  const payload = afterMarker.replace(WHITESPACE_RUN, "");
  const close = payload.indexOf("-->");
  return close < 0 ? payload : payload.slice(0, close).replace(TRAILING_WHITESPACE, "");
}

/** The inner payload of the page's block, or "" when the page has no H1 or no block after it. */
export function extractPayload(text: string): string {
  let seenH1 = false;
  for (const line of text.split("\n")) {
    if (!seenH1) {
      if (line.startsWith("# ")) seenH1 = true;
      continue;
    }
    if (line.includes(MARKER)) return payloadOf(line);
  }
  return "";
}

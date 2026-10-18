// carrier.ts — parser for the crewrig-provenance HTML-comment carrier (spec 0259),
// the TypeScript twin of the retired scripts/lib/provenance-carrier.sh.
//
// Usage: firstBodyLine(text) / carrierField(line, "version")
// Exit codes: not applicable (library).
// Finding-line format: not applicable.

/**
 * The first non-empty line after the second `---` line, exactly as
 * `awk '/^---$/{c++; next} c==2 && NF{print; exit}'`: every `---` line bumps the
 * counter (so a third fence before any body line yields nothing), and a line is
 * non-empty when it holds a character other than a space or a tab.
 */
export function firstBodyLine(text: string): string {
  const lines = text.split("\n");
  // awk does not see an empty trailing record after a final newline.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  let fences = 0;
  for (const line of lines) {
    if (line === "---") {
      fences += 1;
      continue;
    }
    if (fences === 2 && /[^ \t]/.test(line)) return line;
  }
  return "";
}

/**
 * The quoted value of `field` on a carrier line, like
 * a greedy sed substitution on `FIELD="..."`: the last duplicate wins; empty
 * when the field is absent or empty.
 */
export function carrierField(line: string, field: string): string {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^[^\\n]*${escaped}="([^"]*)"[^\\n]*$`).exec(line);
  return match === null ? "" : (match[1] ?? "");
}

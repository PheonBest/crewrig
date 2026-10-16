// classify.ts — the R14 verdict classifier. A missing `<name>=` line is INDETERMINATE, never
// NOT-FOUND: an assistant that failed to answer must not be recorded as one that answered "absent".

export type Verdict = "FOUND" | "NOT-FOUND" | "INDETERMINATE";

const WS = "[ \\t\\r\\n\\f\\v]";

export function classify(answer: string, status: string, name: string): Verdict {
  if (status !== "OK") return "INDETERMINATE";
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^${WS}*${escaped}${WS}*=`);
  const line = answer.split("\n").find((l) => re.test(l));
  if (line === undefined) return "INDETERMINATE";
  const value = line
    .slice(line.indexOf("=") + 1)
    .replace(new RegExp(WS, "g"), "")
    .replace(/[.,;:]/g, "")
    .toUpperCase();
  if (value === "YES") return "FOUND";
  if (value === "NO") return "NOT-FOUND";
  return "INDETERMINATE";
}

/** Count the lines holding exactly `name` (surrounding whitespace allowed). */
export function countListed(listing: string, name: string): number {
  const re = new RegExp(`^${WS}*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}${WS}*$`);
  return listing.split("\n").filter((l) => re.test(l)).length;
}

// classify.ts — the explicit, reviewable rule set that may auto-classify a shell-word hit as
// historical prose (spec 0266 R18). Anything no rule matches stays UNCLASSIFIED for a human.

export interface Classification {
  label: "historical" | "UNCLASSIFIED";
  rule: string;
}

export interface Rule {
  id: string;
  describe: string;
  matches: (file: string, line: string) => boolean;
}

const REMOVAL_WORDS =
  /\b(removed|deleted|retired|formerly|previously|replaced|superseded|legacy|no longer|migrated)\b/i;
const QUOTED_PATH = /(`[^`]*(?:\.sh|\bbash |\bsh )[^`]*`|"[^"]*(?:\.sh|\bbash |\bsh )[^"]*")/;

/** Order matters only for the reported rule id; every rule yields `historical`. */
export const RULES: readonly Rule[] = [
  {
    id: "H1",
    describe: "any line of docs/shell-removal.md (the migration table naming removed paths)",
    matches: (f) => f === "docs/shell-removal.md",
  },
  {
    id: "H2",
    describe: "any line under specs/ (specs are historical records)",
    matches: (f) => f.startsWith("specs/"),
  },
  {
    id: "H3",
    describe:
      "a line that states a removal (removed, deleted, retired, formerly, previously, replaced, superseded, legacy, no longer, migrated) and names the shell word or .sh path inside backticks or double quotes",
    matches: (_f, line) => REMOVAL_WORDS.test(line) && QUOTED_PATH.test(line),
  },
  {
    id: "H4",
    describe: "ci/shell-allowlist.txt, the ratchet's own list of paths (data, not an invocation)",
    matches: (f) => f === "ci/shell-allowlist.txt",
  },
];

export function classify(file: string, line: string): Classification {
  for (const r of RULES) if (r.matches(file, line)) return { label: "historical", rule: r.id };
  return { label: "UNCLASSIFIED", rule: "-" };
}

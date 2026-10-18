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

const GENERIC_PIPELINE_EXAMPLES: readonly string[] = [
  "- run: ./scripts/deploy.sh",
  "- ./scripts/deploy.sh",
  "script: [./publish.sh dist/]",
];
const THIRD_PARTY_INSTALLERS =
  /taskfile\.dev\/install\.sh|setup_24\.x|Homebrew\/install|brew\.sh|get\.scoop\.sh|scoop\.sh|astral\.sh/;

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
  {
    id: "H5",
    describe:
      "any line under docs/adr/, docs/design/ or docs/research/ (accepted ADRs, design notes and research traces are historical records, never rewritten)",
    matches: (f) =>
      f.startsWith("docs/adr/") || f.startsWith("docs/design/") || f.startsWith("docs/research/"),
  },
  {
    id: "H6",
    describe:
      "a line of the github-actions or gitlab-ci skill (source or built copy) that is exactly one of: `- run: ./scripts/deploy.sh`, `- ./scripts/deploy.sh`, `script: [./publish.sh dist/]` (generic examples for an adopter's own pipeline)",
    matches: (f, line) =>
      /(^|\/)skills\/(github-actions|gitlab-ci)\/SKILL\.md$/.test(f) &&
      GENERIC_PIPELINE_EXAMPLES.includes(line.trim()),
  },
  {
    id: "H7",
    describe:
      "a runbook line that quotes the concrete legacy path `dist/stub.sh` of docs/runbooks/extension-mcp-token-probe.md (the probe's stub fixture)",
    matches: (f, line) =>
      f === "docs/runbooks/extension-mcp-token-probe.md" && line.includes("dist/stub.sh"),
  },
  {
    id: "H8",
    describe:
      "a line naming a third-party installer URL (taskfile.dev/install.sh, the NodeSource setup_24.x script, Homebrew install.sh, brew.sh, scoop.sh, get.scoop.sh, astral.sh uv install.sh)",
    matches: (_f, line) => THIRD_PARTY_INSTALLERS.test(line),
  },
  {
    id: "H9",
    describe:
      "a line naming a machine-local generated file: ~/.crewrig/tls-env.sh or ~/.crewrig/mcp-daemon-launcher.sh",
    matches: (_f, line) =>
      /~\/\.crewrig\/(tls-env|mcp-daemon-launcher)\.sh|\.crewrig\/(tls-env|mcp-daemon-launcher)\.sh/.test(
        line,
      ),
  },
  {
    id: "H10",
    describe:
      "the image-generation prompt docs/assets/mempalace-mcp/rotate-token.prompt.md (its box text is the PNG source, tracked in #1712)",
    matches: (f) => f === "docs/assets/mempalace-mcp/rotate-token.prompt.md",
  },
  {
    id: "H11",
    describe:
      "a docs/cli-matrix.md line recording a third-party CLI's own shell behaviour: `bash.exe` (Git for Windows) or `/bin/sh -c '<registered command>'`",
    matches: (f, line) =>
      f === "docs/cli-matrix.md" && (line.includes("bash.exe") || line.includes("/bin/sh -c")),
  },
];

export function classify(file: string, line: string): Classification {
  for (const r of RULES) if (r.matches(file, line)) return { label: "historical", rule: r.id };
  return { label: "UNCLASSIFIED", rule: "-" };
}

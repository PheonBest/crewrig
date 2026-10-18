// sections.ts — the fixed eight-section taxonomy of the public documentation index
// (the shell's SECTION_KEYS and section_title, docs/publication-contract.md). The order is
// significant: it is the order sections appear in docs/index.json.

export interface Section {
  readonly key: string;
  readonly title: string;
}

export const SECTIONS: readonly Section[] = [
  { key: "introduction", title: "Introduction" },
  { key: "concepts", title: "Concepts" },
  { key: "adoption", title: "Adoption" },
  { key: "authoring", title: "Authoring" },
  { key: "lifecycle", title: "Lifecycle" },
  { key: "harness-engineering", title: "Harness engineering" },
  { key: "reference", title: "Reference" },
  { key: "architecture-adr", title: "Architecture & ADRs" },
];

export function isKnownSection(key: string): boolean {
  return SECTIONS.some((section) => section.key === key);
}

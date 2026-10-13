// docs-index-trees.ts — throwaway repository roots for the documentation index tests (spec 0257).
//
// `docsRoot` writes a map of relative paths to file text under a fresh temp directory (resolved to
// its real path, so the shell's logical `pwd` and Node agree); every root is removed when the
// importing test file finishes. `differentialCases` are the trees both the shell and the
// TypeScript implementation are run on.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";

import type { Io } from "../../lib/extension/types.ts";
import { writeTree } from "./extension-trees.ts";
import type { FileMap } from "./extension-trees.ts";

export type { FileMap };

const roots: string[] = [];

after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

/** A fresh root holding `files`. */
export function docsRoot(files: FileMap): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "docs-index-")));
  roots.push(root);
  writeTree(root, files);
  return root;
}

/** A page whose block line is `<!-- crewrig-doc: <block> -->`. */
export function page(block: string, eol = "\n"): string {
  return ["# Title", "", `<!-- crewrig-doc: ${block} -->`, "", "Body."].join(eol) + eol;
}

export function published(section: string, nav: string, title: string, eol = "\n"): string {
  return page(`section=${section} nav_order=${nav} published=true title="${title}"`, eol);
}

export interface Captured {
  readonly io: Io;
  readonly out: string[];
  readonly err: string[];
}

/** An `Io` that records lines, in the shell's one-line-per-call form. */
export function memoryIo(): Captured {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = {
    out: (line) => void out.push(line),
    err: (line) => void err.push(line),
    errRaw: (text) => void err.push(text),
  };
  return { io, out, err };
}

export interface DifferentialCase {
  readonly name: string;
  readonly files: FileMap;
  /** Each step is one invocation's arguments, run in order on the same root. */
  readonly steps: readonly (readonly string[])[];
}

const CLEAN: FileMap = {
  "docs/intro.md": published("introduction", "1", "Intro page"),
  "docs/a.md": published("concepts", "5", "Dot sorts first"),
  "docs/a/b.md": published("concepts", "5", "Slash sorts after"),
  "docs/Z.md": published("concepts", "5", "Upper case first"),
  "docs/ten.md": published("adoption", "10", "Ten"),
  "docs/nine.md": published("adoption", "9", "Nine"),
  "docs/seven.md": published("adoption", "007", "Leading zeros"),
  "docs/seven-b.md": published("adoption", "7", "Same number"),
  "docs/adr/0001.md": published("architecture-adr", "0", "An ADR"),
  "docs/hidden/.md": published("reference", "2", "Named dot md"),
  "docs/draft.md": page("published=false"),
  "docs/\u{1F600}.md": published("reference", "1", "Astral"),
  "docs/～.md": published("reference", "1", "Fullwidth tilde"),
  "docs/slash\\back.md": published("lifecycle", "3", "Back\\slash"),
  "docs/tabbed.md": published("harness-engineering", "4", "Tab\there"),
  "docs/notes.txt": "not a page\n",
};

/** A page per lint rule: each one breaks a single rule. */
const BROKEN: FileMap = {
  "docs/none.md": "# Title\n\nNo block here.\n",
  "docs/nohash.md": "<!-- crewrig-doc: published=false -->\n",
  "docs/noeq.md": page("published"),
  "docs/unterminated.md": page('published=true title="oops'),
  "docs/forbidden.md": page("published=true title=a>b"),
  "docs/unknown.md": page("published=true colour=red"),
  "docs/spaced-key.md": page("published = true"),
  "docs/nopub.md": page("section=concepts"),
  "docs/badpub.md": page("published=yes"),
  "docs/missing.md": page("published=true"),
  "docs/missing-nav.md": page("published=true title=t section=concepts"),
  "docs/badsection.md": page("published=true title=t section=nope nav_order=1"),
  "docs/badnav.md": page("published=true title=t section=concepts nav_order=-1"),
  "docs/emptynav.md": page("published=true title=t section=concepts nav_order="),
  "docs/fine.md": published("concepts", "1", "Fine"),
};

export const differentialCases: readonly DifferentialCase[] = [
  { name: "clean tree, write", files: CLEAN, steps: [[]] },
  { name: "clean tree, write then check", files: CLEAN, steps: [[], ["--check"]] },
  {
    name: "CRLF tree",
    files: Object.fromEntries(
      Object.entries(CLEAN).map(([file, text]) => [file, text.replaceAll("\n", "\r\n")]),
    ),
    steps: [[]],
  },
  { name: "lint failures", files: BROKEN, steps: [[], ["--check"]] },
  {
    name: "orphan entry",
    files: {
      "docs/real.md": published("concepts", "1", "Real"),
      "docs/index.json": '{"pages": [{"path":  "docs/gone.md"}, {"path": "docs/real.md"}]}\n',
    },
    steps: [[]],
  },
  { name: "empty docs tree", files: { "docs/.keep": "" }, steps: [[], ["--check"]] },
  {
    name: "stale manifest",
    files: { "docs/real.md": published("concepts", "1", "Real"), "docs/index.json": "{}\n" },
    steps: [["--check"]],
  },
  {
    name: "missing manifest",
    files: { "docs/real.md": published("concepts", "1", "Real") },
    steps: [["--check"]],
  },
  { name: "no docs directory", files: { "other.txt": "x" }, steps: [[], ["--check"]] },
  { name: "usage error", files: CLEAN, steps: [["--bogus"], ["--check", "extra"], [""]] },
];

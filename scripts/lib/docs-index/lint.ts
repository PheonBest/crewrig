// lint.ts — the publication-contract rules for one page, in the shell's order with its messages
// verbatim (docs/publication-contract.md; the loop body of build-docs-index.sh).
//
// A published page that passes yields a ROW in the shell's own encoding,
// "<section>\t<nav_order>\t<path>\t<title>": `render.ts` splits it back exactly as the shell
// did, so a tab inside a title or a path behaves as it did there.

import { extractPayload } from "./extract.ts";
import { isKnownSection } from "./sections.ts";
import { parseBlock } from "./tokenize.ts";

export interface PageLint {
  /** At most one message per rule hit; several only for the missing required fields. */
  readonly errors: readonly string[];
  /** Set for a valid published page, undefined for an unpublished or invalid one. */
  readonly row: string | undefined;
}

function invalid(...errors: string[]): PageLint {
  return { errors, row: undefined };
}

/** Lint the page `rel` (repository-relative, `/`-separated) whose text is `text`. */
export function lintPage(rel: string, text: string): PageLint {
  const payload = extractPayload(text);
  if (payload === "") return invalid(`${rel}: no crewrig-doc metadata block found`);

  const parsed = parseBlock(payload, rel);
  if (!parsed.ok) return invalid(parsed.error);
  const { section, navOrder, published, title } = parsed.block;

  if (published === undefined) {
    return invalid(`${rel}: metadata block missing required field 'published'`);
  }
  if (published !== "true" && published !== "false") {
    return invalid(`${rel}: 'published' must be 'true' or 'false', got '${published}'`);
  }
  // An unpublished page never enters the index and gets no further validation.
  if (published === "false") return { errors: [], row: undefined };

  const missing: string[] = [];
  if (title === undefined) missing.push(`${rel}: published page missing required field 'title'`);
  if (section === undefined) {
    missing.push(`${rel}: published page missing required field 'section'`);
  }
  if (navOrder === undefined) {
    missing.push(`${rel}: published page missing required field 'nav_order'`);
  }
  if (title === undefined || section === undefined || navOrder === undefined) {
    return { errors: missing, row: undefined };
  }

  if (!isKnownSection(section)) return invalid(`${rel}: unknown section '${section}'`);
  if (!/^[0-9]+$/.test(navOrder)) {
    return invalid(`${rel}: nav_order must be a non-negative integer, got '${navOrder}'`);
  }
  return { errors: [], row: `${section}\t${navOrder}\t${rel}\t${title}` };
}

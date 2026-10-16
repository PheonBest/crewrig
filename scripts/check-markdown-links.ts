// check-markdown-links.ts — validate relative Markdown links across tracked .md files
// (TypeScript twin of check-markdown-links.sh, spec 0259 requirement 16).
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-markdown-links.ts [file1.md file2.md ...]
// Files are relative to the Git top level of the current working directory.
//
// Exit: 0 when every relative link resolves, 1 on a broken link (or outside a Git
// repository, deviation (d)).
// Output (stdout): `FAIL: <file>:<line>: '<target>' -> resolved to '<path>' (does not
// exist)` per broken link, then `Found N broken relative Markdown link(s).`; or
// `All relative Markdown links resolved cleanly.`

import { runMarkdownLinks } from "./lib/governance/md-links.ts";
import { fail, fatal, ok } from "./lib/governance/report.ts";

const outcome = runMarkdownLinks(process.argv.slice(2), process.cwd());
for (const line of outcome.lines) {
  if (line.startsWith("FAIL: ")) fail(line);
  else ok(line);
}
if (outcome.error !== undefined) fatal(outcome.error);
process.exitCode = outcome.code;

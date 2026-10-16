---
id: "0259"
slug: governance-checks-typescript
status: approved
complexity: standard
interaction-mode: MINIMAL
related-issue: 1338
version: 1.1.0
---

# Repository-governance checks in TypeScript

*Delta 01 of `specs/0259-governance-checks-typescript.md`. Source: the implementation,
the differential proofs and the seated reviews of ticket 1338 (pull requests #1619, #1620
and #1623 to #1627): porting the eighteen checks found differences from the shell that
requirement 24 reserved the letters (e) onward for. It runs under the release-branch regime
of `specs/0215-shell-to-typescript-migration.delta-04.md`: its spec-PR targets
`release/1231-ts-migration`, and the base ref of every protocol is
`origin/release/1231-ts-migration` (requirement 34 of that delta). This delta modifies
requirement 24 only. The version is a MINOR bump: no behaviour of the shell changes, the
closed list of deviations is completed with the letters (e) to (m), each found by a test
that names it. This delta opens no question.*

## ADDED

**Scenario:** A duplicated front matter key fails the source

Given a component source whose `metadata` block declares the same key twice
When `check-component-metadata-keys` or `check-feedback-routing` reads it
Then the source is reported as a failure with `duplicated mapping key in front matter` and
the check exits 1 (the shell reported each duplicate through `yq`, or none outside
`metadata`).

**Scenario:** A malformed tesseract output ends the figure check cleanly

Given a `tesseract` whose output has a non-integer geometry cell
When `check-figure-labels` runs on two figures
Then the lines of the first figure are printed, then one `Error: <png>: <reason>` line goes to
standard error and the exit status is 1, with no stack trace.

## MODIFIED

### Requirement 24 — deviations

Original:

<!-- markdownlint-disable-next-line MD029 -->
> 24. **Deviations (closed list).** (a) Ordering follows requirement 6. (b) On Windows,
>     paths printed by `check-markdown-links` and `check-figure-labels` use forward slashes.
>     (c) `check-test-strays` on `win32` follows requirement 20. (d) Where the shell fails
>     through its own runtime and not through a message of the script (an unreadable or
>     missing input file whose `set -e` failure prints a Bash diagnostic that carries the
>     script path and a line number, as `check-agents-size` does for a missing path), the
>     entry SHALL print one `Error: <path>: <reason>` line on standard error and exit 1
>     (the status of the shell's `set -e` abort); such inputs are excluded from the byte
>     comparison of requirement 26, which still compares their exit status. No other
>     deviation is permitted.

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> 24. **Deviations (closed list).** Letters (a) to (d) are unchanged. (e) A duplicated
>     mapping key in the front matter of a source read by `check-component-metadata-keys`
>     or `check-feedback-routing` is a failure of that source (`duplicated mapping key in
>     front matter`, exit 1): the YAML reader rejects it, and a false pass is the wrong
>     direction for a governance check. (f) The shell's `check-skill-versions` runs a
>     stray `git fetch` through an unescaped backtick substitution in its unresolvable-base
>     diagnostic; the entry prints the diagnostic text the shell prints and does not run
>     the fetch. (g) The traceback lines that the shell's `python3` prints on a failure
>     (`check-gemini-overlay-enrollment`) carry an interpreter path and are not reproduced;
>     they are excluded from the stderr comparison and the `Error:` lines are compared.
>     (h) `check-markdown-links` run outside a Git repository prints one
>     `Error: <directory>: not a git repository` line on standard error and exits 1 (the
>     Python printed a traceback). (i) An unparsable or non-object `package.json` or
>     `extension.json` read by `check-extension-manifest-version` prints one `Error:`
>     line and exits 2; the text of `jq` differs. (j) A failure while `check-figure-labels`
>     processes a figure (a non-integer geometry cell, tesseract output that is not valid
>     UTF-8) flushes the lines already produced, then prints one `Error: <png>: <reason>`
>     line on standard error and exits 1 (the Python printed a traceback). (k)
>     `check-figure-labels` does not traverse symlinked sidecars or symlinked directories
>     below `docs/assets`. (l) Its TSV integer parser accepts ASCII digits only. (m) A
>     path that the shell prints from a logical `pwd` (`check-extension-hook-map`, the
>     document path) is printed by the entry as the physical path; the two differ only
>     where the working directory crosses a symbolic link (a macOS temporary directory).
>     No other deviation is permitted.

## REMOVED

Nothing is removed.

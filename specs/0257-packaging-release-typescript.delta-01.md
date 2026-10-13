---
id: "0257"
slug: packaging-release-typescript
status: draft
complexity: standard
interaction-mode: MINIMAL
related-issue: 1336
version: 1.1.0
---

# Documentation index, extension packaging and monorepo release in TypeScript

*Delta 01 of `specs/0257-packaging-release-typescript.md`. Source: the implementation and
review of ticket 1336 (pull requests #1588 to #1594): the differential tests, the black-box
suite run on both legs, the entry-level goldens and the seated reviews found differences from
the shell that requirement 31 reserved the letters (i) onward for, and the order of two pull
requests of requirement 32 changed. It runs under the release-branch regime of
`specs/0215-shell-to-typescript-migration.delta-04.md`: its spec-PR targets
`release/1231-ts-migration`, and the base ref of every protocol is
`origin/release/1231-ts-migration` (requirement 34 of that delta). This delta modifies
requirements 31 and 32 and adds scenarios. The version is a MINOR bump: no behaviour of the
shell changes, the closed list of deviations is completed with the letters (i) to (n), each
found by a test that names it, and the staging sentence records the order that ran. Line
references are to `release/1231-ts-migration` at `969088f`. This delta opens no question; the
open questions of the parent stand, except the first, which the Windows proof answers by its
design: the real engine is stubbed behind no production seam (the stub replaces
`release-rehearse.mjs` in the sandbox copy only).*

## ADDED

**Scenario:** The usage line of the documentation index names the entry, not the shell path

Given no argument other than an unknown flag
When `node scripts/build-docs-index.ts --bogus` runs
Then standard error holds `Usage: build-docs-index [--check]` and the exit status is 2.

**Scenario:** A termination signal stops the release driver without a failure line

Given a rehearsal in progress with the engine running in a child process
When the driver receives `SIGTERM`
Then the child is stopped, the scratch directory is removed, no `RELEASE-FAILED` line and no
closing summary is printed, and the exit status is 143.

**Scenario:** A synchronised manifest keeps its permission bits

Given a `package.json` of mode `0644` and an `extension.json` of mode `0664`
When `node scripts/release-sync-manifests.ts 1.2.3` runs in their directory
Then both are rewritten with the new version, two-space indented with a trailing line feed, and
keep their modes.

## MODIFIED

**Requirement 31 — Deviations.** Original, the closing sentence:

> Letters (i) onward are reserved for what the differential test finds, each added through a
> delta of this spec.

Replacement:

> The list continues with the deviations that the differential tests, the black-box suite and
> the seated reviews found; each is listed here and none other exists: (i) the usage line of
> the documentation index is `Usage: build-docs-index [--check]`, where the shell prints
> `Usage: <$0> [--check]` with the path it was started by (a forwarding shim has no `$0` to
> report); (j) a documentation page that is not valid UTF-8 contributes its title with each
> invalid byte replaced by U+FFFD, where the shell copies the bytes; (k) a root or output path
> of the prepare commands that starts with two separators, or holds a backslash on a platform
> other than Windows, is refused as a UNC path or an unsafe character, naming the path; (l) the
> manifest synchronisation parses both manifests before writing either, so that a malformed
> sibling leaves both untouched where the shell loop could rewrite the first and then fail, keeps
> the permission bits of an existing manifest where the shell's `jq > tmp && mv` made a fresh
> file at the umask's default, writes numbers as `JSON.stringify` does (`1.0` as `1`, an integer
> above 2^53 rounded) where `jq` keeps the literal, and refuses an empty version and a manifest
> that is not a JSON object, which none of the repository's manifests is; (m) the release
> driver removes its scratch directory and what it created under `dist/` also when a flow
> throws, treats an engine verdict that is not JSON as `RELEASE-FAILED <ext> step=engine` where
> the shell aborted under `set -e`, and on a termination signal stops every child it started
> (the engine, the release-PR synchronisation and the prepare command), removes the scratch
> directory, prints neither a failure line nor the closing summary, skips the release-PR
> synchronisation (an empty list of entries would close an open release PR), and exits 130 or
> 143, where the shell's trap only removed the directory on exit; (n) the packager spawns the
> builder with the running Node.js executable rather than a bare `node`. Entries that were
> suspected and found identical are not deviations: an unreadable or malformed
> `extension.json` makes both implementations exit silently with `jq`'s own statuses (2 and 5),
> and both skip hidden directories in the extension walk.

**Requirement 32 — Staging.** Original, the first sentence:

> The work SHALL ship as: oracle hardening and black-box coverage of the driver; dark modules
> (archive writer and documentation index; packaging entries; release driver), each with its
> unit suites; the entries, the differential proof, the goldens and the Windows job; the
> retargeting of static reads; the switch (requirements 22 and 28); the status flip.

Replacement:

> The work SHALL ship as: oracle hardening and black-box coverage of the driver; dark modules
> (release driver preflight and configuration; archive writer and documentation index; packaging
> modules; release driver process layer, mirror, flows and `main`), each with its unit suites;
> the entries, the differential proof, the goldens and the Windows job; the retargeting of
> static reads, which needs no entry and may land before or beside the entries; the switch
> (requirements 22 and 28); the status flip. The goldens SHALL be generated in a Linux
> container and regenerated in a second image with Node.js under a runner-like path, and a
> sandbox that copies an extension SHALL copy only what git tracks, so that no host-installed
> `node_modules` or `dist` reaches a build tree or an archive.

## REMOVED

None.

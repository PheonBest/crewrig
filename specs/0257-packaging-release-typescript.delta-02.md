---
id: "0257"
slug: packaging-release-typescript
status: approved
complexity: small
interaction-mode: MINIMAL
related-issue: 1599
version: 1.2.0
---

# Documentation index, extension packaging and monorepo release in TypeScript

*Delta 02 of `specs/0257-packaging-release-typescript.md`. Source: ticket 1599, found while
regenerating the goldens of ticket 1336. When the packaging machine holds a workspace install
(`npm install` at the repository root), `extensions/<name>/node_modules` exists on disk, the
Gemini render copies it into `build/extensions/<name>` with the rest of the extension directory,
and the release archive of requirement 10 ships every host package in it. The shell did the same
(`cp -a "$src"/. "$dst"/`), and requirement 31 listed no deviation for it. The release archive
is meant to carry what the build produces from the extension's sources, whatever the install
state of the machine that packages it. It runs under the release-branch regime of
`specs/0215-shell-to-typescript-migration.delta-04.md`: its spec-PR targets
`release/1231-ts-migration`. This delta adds requirement 33 and a deviation of requirement 31,
and opens no question. The version is a MINOR bump: one behaviour of the shell changes, on one
input that the shell never meant to ship.*

## ADDED

**Requirement 33 — No host-installed package in a build tree.** The Gemini render of
spec 0254 (the `build/extensions/<name>` tree that requirement 9 packages) SHALL NOT copy a
directory, or a symbolic link, named `node_modules`, at any depth of the extension directory, into the build
tree. The filter lives in the tree copy of the render, so that the build tree and the archive
of requirement 10 follow one definition and the packager holds no second one. A regular file
named `node_modules` is copied as before. The `dist/` directory is not
filtered: it is the declared output of the extension's own build (the delivered MCP server of
spec 0254 requirement 11), untracked by design, and the render has no way to tell a stale
`dist/` from a fresh one. The copy of requirement 17's release clone, the plugin outputs of the
other three CLIs and the test sandboxes of requirement 32 are unchanged.

**Scenario:** An untracked `node_modules` does not reach the build tree or the archive

Given an extension whose directory holds an untracked `node_modules/some-package/index.js`, a
nested `tools/node_modules/other/index.js` and a tracked `src/index.js`
When `node scripts/release-package-extension.ts <name> --version <v> --out <dir>` runs
Then no entry of `build/extensions/<name>` and no entry of `<dir>/<name>-<v>.tar.gz` has a
path component `node_modules`, and `src/index.js` is in both.

**Scenario:** The archive does not depend on the install state of the machine

Given the same extension packaged once on a checkout without `node_modules` and once on a
checkout where `npm install` left `extensions/<tier>/<name>/node_modules`
When the two archives are written
Then their decompressed streams are byte-identical.

**Scenario:** `dist/` still travels

Given an extension whose directory holds a built `dist/index.js`
When the Gemini render runs
Then `build/extensions/<name>/dist/index.js` exists.

## MODIFIED

**Requirement 31 — Deviations.** Original, the closing sentence of delta 01's replacement:

> Entries that were suspected and found identical are not deviations: an unreadable or malformed
> `extension.json` makes both implementations exit silently with `jq`'s own statuses (2 and 5),
> and both skip hidden directories in the extension walk.

Replacement:

> (o) the Gemini build tree and the release archive hold no directory named `node_modules`,
> where the shell copies the one a workspace install left in the extension directory
> (requirement 33). Entries that were suspected and found identical are not deviations: an
> unreadable or malformed `extension.json` makes both implementations exit silently with
> `jq`'s own statuses (2 and 5), and both skip hidden directories in the extension walk.

## REMOVED

None.

## Decision record

**Decision D5 — where the filter lives.** *Adopted:* requirement 33, a name filter in the tree
copy of the Gemini render (spec 0254 requirement 6), so that `build/extensions/<name>` and every
consumer of it, the archive included, are clean by construction. *Rejected:* (i) a filter in the
archive writer only: the build tree would stay dirty, `--check` and the install paths would
still read host packages, and the writer, which requirement 11 keeps a pure function of the tree
it is given, would gain a policy; (ii) copying `git ls-files` only: the release clone and the
test sandboxes carry no `.git` of their own, and the declared `dist/` is untracked; (iii) a
tracked-or-declared allow-list in `extension.json`: a new manifest field and a migration for
one input that no extension wants shipped; (iv) also dropping `dist/`: it is the delivered MCP
server, so the filter would break the extensions that ship one.

**Known consequence.** An extension whose `package.json` lists runtime `dependencies` (the
reference extension `hello-world` does) ships them only if its own build bundles them into
`dist/`; the archive no longer carries the packager machine's installed copies. Installing
declared dependencies is the consumer's concern, and is not changed here.

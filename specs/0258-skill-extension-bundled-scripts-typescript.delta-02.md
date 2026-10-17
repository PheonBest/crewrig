---
id: "0258"
slug: skill-extension-bundled-scripts-typescript
status: draft
complexity: small
interaction-mode: MINIMAL
related-issue: 1611
version: 1.2.0
---

# Skill- and extension-bundled scripts in TypeScript

*Delta 02 of `specs/0258-skill-extension-bundled-scripts-typescript.md`. Source: the review
ledger of row H, issue #1611 (the deferred, non-blocking findings of pull requests #1603 to
#1610). It runs under the release-branch regime of
`specs/0215-shell-to-typescript-migration.delta-04.md`: its spec-PR targets
`release/1231-ts-migration`. No behaviour of any script changes. The delta adds four
test and CI hardening requirements (36 to 39) and records two decisions on the behaviour
differences the ledger listed, neither of which adds a deviation letter. The version is a
MINOR bump. This delta opens no question.*

## ADDED

36. **Frozen install of the extension-builder job.** The CI job `extension-builders-ts`
    SHALL install its dependencies with `npm ci --workspaces=false` (the lockfile frozen, the
    workspace packages not installed), not `npm install --include=dev`. The production closure
    the builders need is unchanged by the switch: the dev dependencies of the root package
    are installed, the workspace packages are not. The three carriers of the job
    (`.github/workflows/build.yml`, `ci/ci-capabilities.yml` and the regenerated
    `.gitlab-ci.yml`) and the install-line pattern of
    `scripts/tests/extension-ci-wiring.test.ts` SHALL change together, and the pattern SHALL
    keep rejecting an install that resolves instead of freezing.

37. **Unit tests of the scaffolder prompt.** `parseAnswer` and `promptComponents` of
    `scripts/lib/create-extension/prompt.ts` SHALL each have a unit test that does not go
    through the full scaffolder flow: numbers, names, mixed separators, duplicates, the empty
    answer, an unknown word (`null`), offered-order output, a re-ask after an unrecognised
    answer, and a closed input (no component).

38. **Windows curator proof scans something.** `assertNoCarriageReturn` of
    `scripts/tests/lib/windows-curator-proof.ts` SHALL fail when its scan reads no file at all,
    and the guard SHALL be tested with an empty landing zone.

39. **Exhaustive callers guards.** The fixed lists of
    `scripts/tests/lib/skill-scripts-callers.ts` and
    `scripts/tests/lib/harness-curator-callers.ts` SHALL be backed by a repository-wide scan
    over the tracked files: no tracked file outside a named allow-list SHALL carry a retired
    spelling (`<name>.sh`, or the bare name after `scripts/`) of the eleven skill scripts or
    the three curator scripts. The allow-list names its reason per entry (specs, ADRs,
    the shims and the Bash oracle, the built mirrors that are regenerated from `artifacts/`),
    and the scan SHALL be tested for non-vacuity. Separately, the teardown of the Windows
    install proof SHALL retry on `EPERM` and `EBUSY`
    (`scripts/tests/lib/build-fixture-tree.ts`, `dispose`), so that a directory held for a
    moment by the previous step does not fail a whole `Build & Validate` run.

**Scenario:** The extension-builder job freezes its lockfile

Given the reference `ci/ci-capabilities.yml` and the workflow `build.yml`
When the install step of `extension-builders-ts` is read
Then it is `npm ci --workspaces=false`, and the wiring test fails on
`npm install --include=dev` for that capability.

**Scenario:** A scan that walks nothing fails

Given an empty home, work and temporary directory
When `assertNoCarriageReturn` runs on them
Then it throws that no file was scanned.

**Scenario:** A new caller outside the fixed list is caught

Given a tracked file outside every allow-list entry that names `lint-json.sh`
When the repository-wide callers scan runs
Then it reports that file by path.

## MODIFIED

Nothing is modified. Two decisions on the ledger's behaviour differences are recorded here,
and neither adds a letter to requirement 31:

- **NUL byte of a hook payload (ledger item i1-F4 of #1606).** The shell `read` drops a NUL
  byte, the TypeScript hook keeps it. Not recorded as deviation (s): a hook payload is JSON
  text produced by the CLI, and a raw NUL cannot occur in valid JSON (it is escaped as
  `\u0000`), so no caller can depend on the difference. The entry keeps the byte; a test
  that pins it is not worth its upkeep.
- **`lint-json` without `jq` (ledger item of delta 01).** Already deviation (r) of delta 01,
  with its scenario and its test. Nothing to add; the note that scripted callers will see
  exit 1 instead of the silent exit 0 is part of (r).

## REMOVED

Nothing is removed.

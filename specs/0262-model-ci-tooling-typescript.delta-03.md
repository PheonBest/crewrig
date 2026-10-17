---
id: "0262"
slug: model-ci-tooling-typescript
status: approved
complexity: standard
interaction-mode: MINIMAL
related-issue: 1339
version: 1.3.0
---

# Model, CI and spec-workflow tooling in TypeScript

*Delta 03 of `specs/0262-model-ci-tooling-typescript.md`, on top of deltas 01 and 02. Source:
the run of the unchanged Bash suite `scripts/tests/test-check-model-mappings.sh` through the
differential wrapper (PR 4 of ticket #1339), which showed that the diagnostic of its case A0
(a mapping file that is not valid YAML) carries the text of the YAML parser: the shell prints
the message of `yq` (go-yaml), the twin cannot print it and prints the message of `js-yaml`.
It runs under the release-branch regime of
`specs/0215-shell-to-typescript-migration.delta-04.md`: its spec-PR targets
`release/1231-ts-migration`. This delta modifies requirement 24 as replaced by delta 02 (one
item added). The version is a MINOR bump: one case is added to a closed list. This delta opens
no question.*

<!-- markdownlint-disable MD029 -->

## ADDED

**Scenario:** A mapping file that is not valid YAML

Given a `model-mappings/claude.yml` with an unterminated flow collection
When  `check-model-mappings` runs as the TypeScript entry
Then  it prints the same `A0` finding line, naming the same file, and exits with the same
      status as the shell, and the text of the parser message that follows may differ.

## MODIFIED

24. **Deviations (closed list).** Requirement 24 of the base spec, as replaced by delta 02, is
    replaced again by items (a) to (h) of deltas 01 and 02, unchanged, followed by one item.
    (i) The text of a YAML syntax-error message that a script prints after its own finding
    identifier and file name (the `A0` case of `check-model-mappings`, the equivalent line of
    `check-agent-profiles` and of `build-ci` where the shell prints `yq`'s message): the
    entry SHALL print the same finding identifier, the same file name and the same exit
    status, followed by the message of the YAML parser it uses; the differential proof masks
    only that message and compares everything else byte for byte. No other deviation is
    permitted.

## REMOVED

None.

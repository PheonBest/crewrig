---
id: "0260"
slug: hook-ops-tests-typescript
status: approved
complexity: standard
interaction-mode: MINIMAL
related-issue: 1340
version: 1.1.0
---

# Bash tests of hooks, usage and operational commands in TypeScript

*Delta 01 of `specs/0260-hook-ops-tests-typescript.md`. Source: the first cold review
of the plan of ticket #1340 (seat `plan/1340`, findings v1-F1, v1-F4 and v1-F5) and the
CI wiring survey it asked for. It runs under the release-branch regime of
`specs/0215-shell-to-typescript-migration.delta-04.md`: its spec-PR targets
`release/1231-ts-migration`, and the base ref of every protocol is
`origin/release/1231-ts-migration`. This delta modifies requirements 16 and 18 and
corrects three table cells of the suite sections. The version is a MINOR bump: no
requirement is relaxed, the wiring requirement gains the two forms that the continuous
integration guard accepts, and the files of other rows are bounded. This delta opens no
question.*

## ADDED

**Scenario:** A step inside a cache layer keeps its scan

Given a Bash suite whose job step runs inside
`bash scripts/ci-cache-guard.sh --cache-dir ... --key-files ... --key-env "" --` and
inside the stray-scan wrapper
When its replacement is wired
Then the step keeps the cache layer and the wrapper nested inside it, around the
`node --test` command, the declared command in `ci/ci-capabilities.yml` equals the step
once the cache layer is removed, and the cache key inputs of the capability, the
`hashFiles` list and every `--key-files` list of the job name the same files.

**Scenario:** A replacement file named like an existing glob joins that job

Given a replacement file whose name matches the `node --test` glob of an existing
capability (for example `worktree-*.test.ts`)
When the replacement is wired
Then it runs in that capability's job on Linux and, where the job has one and subject to
requirement 17, on `windows-latest`, it gets no second step, and the job that ran the deleted Bash suite loses
its step.

## MODIFIED

**Requirement 4**, the three table cells that name a helper in the suite sections.

Original: `usage-storage-driver.cjs`, `usage-attribution-driver.cjs` and
`usage-pricing-driver.js` (the "committed driver" helpers of the usage suites).

Replacement: `usage-storage-driver.ts`, `usage-attribution-driver.ts` and
`usage-pricing-driver.ts`, and the word "CJS" in the cell of the first becomes "TypeScript". Requirement 4 already says that every new file is TypeScript,
and the shell-and-JavaScript ratchet of parent requirements 10 and 11 admits no new
JavaScript file; the three cells named a JavaScript file by mistake. A TypeScript driver
runs as a child process the same way, and keeps the isolation the Bash driver gave.

**Requirement 16.**

Original: "Each CI job that ran a deleted suite SHALL run its replacement through `node --test`,
inside the stray-scan wrapper wherever the Bash invocation had it, in the same file and
under the same job id, and the path filters of the job SHALL name the replacement files."

Replacement: each CI job that ran a deleted suite SHALL run its replacement through
`node --test`, in the same file and under the same job id, in the same form as the Bash
step: a step that was wrapped by `bash scripts/ci-cache-guard.sh --stray-scan --` stays
wrapped; a step that ran inside a cache layer keeps the layer with the wrapper nested
inside it (the two options of the guard are mutually exclusive in one invocation); a step
that was neither stays plain. A replacement file whose name matches the glob of an
existing capability joins that capability's job, and is wired nowhere else. The path
filters, the cache key inputs and the `hashFiles` and `--key-files` lists of the job SHALL
name the replacement files in lockstep, and the job's declared command in
`ci/ci-capabilities.yml` SHALL equal its step once the cache layer is removed. A suite
that prints the phrase `command not found` SHALL NOT let it reach the output that the
scan reads.

**Requirement 18.**

Original: the second sentence, "Two edits outside this row's own files are authorized by the
coordinator and are the only ones: (a) the lines of `scripts/tests/test-check-ci-parity.sh`
(row J2) that select the `usage-pricing` capability, its workflow job and its
`test-usage-pricing` step SHALL be retargeted ...; (b) the comments of
`scripts/lib/usage-capture/record.js`, `scripts/lib/usage-capture/sink.js`,
`scripts/lib/usage-store/mcp.js` and `scripts/worktree-claim.sh` that name a deleted suite
MAY be edited, comment text only, with no change of behaviour."

Replacement: that sentence is kept as it stands, with edits (a) and (b) unchanged, and the
following sentence is added after it. A comment in a file of another row that names a
deleted suite and that is not named in (b) SHALL be left to its owning row and reported to
the coordinator in the pull request body; this row SHALL NOT edit that file. At the time of
writing this applies to the comment at line 367 of `scripts/tests/test-mcp-daemon.sh` (row
J1b).

## REMOVED

Nothing is removed.

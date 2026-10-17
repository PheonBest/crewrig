---
id: "0266"
slug: final-removal-and-termination
status: draft
complexity: standard
interaction-mode: MINIMAL
related-issue: 1344
version: 1.0.0
---

# Final shell removal, empty allowlist and epic termination

_Sub-spec J4 of the `large`-tier ticket #1231, row J4 of the architect decomposition
(<https://github.com/crewrig/crewrig/issues/1231#issuecomment-5857477069>). Parent spec:
`specs/0215-shell-to-typescript-migration.md` (requirements 7, 9, 10, 13, 15, 23, 25, and 26 of
`specs/0215-shell-to-typescript-migration.delta-01.md`), under the release-branch regime of
`specs/0215-shell-to-typescript-migration.delta-04.md` (requirements 27-38): this spec-PR and its
implementation pull requests target `release/1231-ts-migration`, and the base ref wherever a protocol
names `main` is `origin/release/1231-ts-migration` (requirement 34). Siblings that leave work to this
row: J1a (`specs/0260-hook-ops-tests-typescript.md`, #1340), J1b
(`specs/0263-setup-service-tests-typescript.md`, #1341), J2 (`specs/0265-build-checks-tests-typescript.md`, ticket
1343), J3 (`specs/0261-e2e-harness-probes-typescript.md` and its deltas, #1342), H
(`specs/0258-skill-extension-bundled-scripts-typescript.md`, #1337), G2
(`specs/0257-packaging-release-typescript.md`, #1336) and I2
(`specs/0262-model-ci-tooling-typescript.md` and its deltas, #1339). I2 and J2 are not merged at
authoring time; requirement 24 is how this spec stays true while they land._

## Intent

After this row, a contributor or an adopter finds no shell script in CrewRig: no tracked `.sh` file or
shebang script, no forwarding shim, no shell library, no Bash test, no shell-only convention checker, and
no task, workflow step, hook, statusline or documentation page that invokes one. The shell ratchet stays
in force with an empty allowlist, so a pull request that adds a shell file fails. An adopter whose
installed hook or statusline line still names a removed script is told how it is repaired and finds the
removal in the release notes, and the documented recovery for a defective `sync-from-upstream.ts` still
works after the final merge. The maintainer gets one audit report that shows, from evidence, that the
termination criteria of the parent hold on the release branch, with the one measurement that has not been
taken (#1601) recorded as an open gap rather than claimed.

<!-- markdownlint-disable MD029 -->

## Requirements

### Scope and sequencing

1. **What this row removes.** This row SHALL remove, and nothing else: (a) the shell libraries and
   their last consumers (requirements 2 to 4); (b) the shell-only conventions of parent requirement 26
   (requirement 5); (c) every remaining forwarding shim (requirements 6 to 12); (d) every shell
   invocation in `Taskfile.yml`, workflows and generated CI (requirements 13 to 16); (e) every remaining
   allowlist entry (requirement 17). Row-owned work of I2 and J2 is not done here (requirement 24).
2. **Each deletion travels with its last consumer.** A shell file SHALL be deleted in the same pull
   request that removes or rewrites its last consumer: a library with the suites that source it, a shim
   with the tests that exercise its forwarding, the test that exercises a script with that script. No
   pull request SHALL leave a file that sources, calls or names a path deleted by an earlier pull request
   of this row; the check is that the whole suite and the ratchet are green on every pull request.
3. **Libraries retired.** The following sourced libraries SHALL be deleted, each with its consumers:
   `scripts/lib/common.sh` and the libraries only it sources (`gemini-settings.sh`,
   `mcp-daemon-launcher.sh`, `render-command.sh`, `tls-exec.sh`); `scripts/lib/extension-hooks.sh`,
   `extension-install.sh`, `component-resolve.sh`, `model-resolve.sh`, `base-ref-resolve.sh`,
   `usage-capture-optin.sh` and `tls-delegation.sh`; and the end-to-end oracle libraries
   `tests/e2e/lib/{assert,structural,expand,mask_command,llm_judge}.sh`,
   `tests/e2e/lib/llm_judge_drivers/*.sh` and `scripts/e2e/lib/auth-common.sh`. The list is the inventory
   at authoring time; requirement 24 governs any difference at the time of the pull request.
4. **Test ports retired with their library.** Every test file whose header carries `Retires with
<library> (row J4)` (specs 0252, 0260, 0261, 0263 and 0265 define the marker), the POSIX-only
   bash-spawning ports and the shell-oracle legs of the recorded-tuple differentials
   (`scripts/tests/lib/e2e-oracle-*`, `e2e-judge-*`, `e2e-auth-differential.test.ts`,
   `scripts/tests/lib/shell-extension-harness.ts`) SHALL be deleted with the library they exercise. The
   assertions of such a port are NOT re-homed: each has already a TypeScript twin that does not need the
   library (specs 0252 to 0265 name them), and the pull request SHALL show, per deleted port, the twin
   that keeps the behaviour. A behaviour with no twin SHALL be moved to a new TypeScript test before the
   port is deleted, never dropped.
5. **Shell-only conventions retired (parent requirement 26).** `scripts/check-bash32-portability.sh`,
   `scripts/check-pipefail-grep.sh`, `scripts/lib/bash32-array-guard.sh`, their Bash tests
   (`test-check-bash32-portability.sh`, `test-check-pipefail-grep.sh`), their CI wiring (job, path
   filters, `Taskfile.yml` tasks, `ci/ci-capabilities.yml` rows), and `artifacts/core/skills/pr-reviewer/scripts/lint-shell.sh`
   SHALL be deleted, together with any TypeScript port of them left by row H or later, and with every
   rule or paragraph in `docs/`, `AGENTS.md`, `DEVELOPMENT.md` and `SKILL.md` files whose only subject is
   shell style, `shellcheck`, Bash 3.2 portability or `set -o pipefail` hygiene.
   Deleting a component source SHALL be followed, in the same commit, by the build of `artifacts/` so that
   the built copies tracked under `.claude/`, `.gemini/`, `.github/` and `.agents/` (for example the four
   `lint-shell.sh` copies) disappear with their source.
   `docs/research/artifacts/147/trace-gemini-p.sh` SHALL be deleted, and any reference to it SHALL be
   removed; it is a research trace, not a shipped entry point, and retains its value through the recorded
   output next to it.

### Shim removal and adopter compatibility

6. **Every shim is removed.** Every tracked forwarding shim (a `.sh` file that only invokes its
   TypeScript replacement; the 98 entries classified as such in `ci/shell-allowlist.txt` at authoring
   time) SHALL be deleted. The classification SHALL be re-derived by a script (requirement 24), not
   copied from this spec, and a shim whose caller class is not decided by requirement 7 SHALL be decided
   by the plan with the same rule, recorded in the pull request.
7. **Caller classes.** Each shim SHALL be assigned to exactly one class, recorded in the pull request
   that removes it, by who can still call it:
   - **Class A, adopter entry points typed or scripted by a person:** `setup-*-interactive.sh`,
     `sync-from-upstream.sh`, `install-*`, `manage-*`, `import-*-history.sh`, `unlink-*`, `usage-*`,
     `doctor-mempalace.sh`, `switch/repair-mempalace-http.sh`, the `*-chroma-server.sh` and
     `*-mcp-server.sh` scripts, `uninstall-mcp-daemon.sh`, `prune-transcripts.sh`, `worktree-claim.sh`,
     `create-extension.sh`, `migrate-extension.sh`, `package-*`, `release-package-extension.sh`,
     `monorepo-release.sh`, `build-*` and `check-*` entry points.
   - **Class B, command lines installed in a CLI configuration or an OS scheduler:** the hook commands
     (`hooks/mempalace-transcript.sh`, `hooks/usage-capture.sh`, `hooks/worktree-git-guard.sh`), the
     Antigravity statusline command (`hooks/antigravity-statusline-shim.sh`), and the legacy entries
     written by the old `schedule-curator.sh`.
   - **Class C, internal callers only** (test scenario `run.sh` files, `tests/e2e/run.sh`,
     `e2e/auth-*.sh`, probes): deleted with their last internal caller and need no compatibility.
8. **Class A behaviour after removal.** A legacy invocation of a removed Class A path SHALL NOT be kept
   alive by any tracked shell file (requirement 17 forbids it). The removal SHALL be announced instead in
   the release notes, in `docs/` pages that named the old path (updated to the `node` form), and in a
   migration table at `docs/shell-removal.md` mapping every removed path to its replacement command. The
   shell's own "No such file" message is the legacy caller's observable result; this spec adds no
   interception.
9. **Class B: installed command lines are rewritten, not trusted.** Setup SHALL keep rewriting an
   already-installed command line that names a removed shim to the direct `node "<path>/<script>.ts"`
   form on its next run (parent requirement 15). The recognition corpora that decide which installed
   lines are CrewRig's (`scripts/tests/fixtures/mempalace-transcript/recognition-corpus.json` and its
   siblings for the usage-capture hook, the worktree guard and the statusline) SHALL keep their legacy
   `.sh` entries after the shims go: the rewriter recognises a form that no file backs any more. A
   test SHALL assert, for each Class B hook, that a configuration carrying the `.sh` form is rewritten to
   the `.ts` form by a setup run and that a second run writes nothing.
10. **Class B: what a legacy line does before setup is re-run.** A hook line that names a removed `.sh`
    SHALL be documented, in the release notes and `docs/shell-removal.md`, as failing with a missing-file
    error until setup is re-run; the document SHALL state per CLI whether the CLI treats that failure as
    blocking, and SHALL state that for `hooks/worktree-git-guard.ts` the guard is absent until the
    rewrite, so an adopter who relies on it re-runs setup immediately. The statement SHALL come from a
    measurement of each CLI's behaviour on a missing hook file, recorded in `docs/cli-matrix.md`; a cell
    not measured SHALL say so (requirement 22).
11. **Legacy cron entry of the harness curator.** The Linux `crontab` marker line `# crewrig-harness-curator
(managed by schedule-curator.sh)` and the command line under it, written by an earlier
    `schedule-curator.sh`, SHALL be handled by a documented manual step: release notes and
    `docs/shell-removal.md` SHALL tell the user to run `crontab -e` and delete the marker line and the
    command line below it, state that the job fails after the `curate.sh` shim is removed and logs to
    `~/.local/state/crewrig/harness-curator.log`, and state that the macOS `launchd` plist of the same
    name is replaced in place and is not affected. No code of this row SHALL read or write a crontab
    (parent requirement 23).
12. **Sync recovery after the shim removal.** The recovery of #1524 (restore `scripts/sync-from-upstream.sh`
    from commit `cad08ac64d30dcd3ed96b4aadaf156ed7673abae`, run it once, a further run is a no-op) SHALL
    be re-verified by a test or recorded rehearsal on the release branch head after the `sync-from-upstream.sh`
    shim is deleted and on a throwaway clone of the final merge result (requirement 20): the commit
    resolves, `git checkout <commit> -- scripts/sync-from-upstream.sh` restores shell text, running it
    reconciles the TypeScript files against upstream, and the next run is a no-op. The procedure text in
    `docs/` SHALL state that the commit is reachable only through a merge commit (requirement 20) and
    SHALL name this dependency, so a later maintainer does not squash the final merge.

### Toolchain, Taskfile and CI

13. **Taskfile without shell.** Every task of `Taskfile.yml` SHALL invoke only commands permitted by
    parent requirement 23 (`node`, `npm`, the tool binaries of the lockfile, Git, the forge CLIs,
    the four supported CLIs, the service managers); no task SHALL name `bash`, `sh`, a `.sh` path or a
    POSIX-only utility, and the `sh:` preconditions that use `test -x` SHALL be rewritten to a Node
    one-liner or a `.ts` check. The tasks named in the `Taskfile.yml` of the base commit that run a Bash
    suite or a retired check SHALL be removed or re-pointed at the `node --test` equivalent.
14. **Lint and format tasks.** The lint tasks SHALL run `oxlint --type-aware` and the format tasks SHALL
    run `oxfmt --check` over the whole TypeScript tree, and no shell-lint task SHALL remain (#1344 first
    comment). A failing Oxlint or Oxfmt run SHALL fail the task.
15. **CI without allowlist carve-outs.** `.github/workflows/build.yml` and the generated `.gitlab-ci.yml`
    SHALL run the tasks of requirement 14 over the whole TypeScript tree with no path exclusion and no
    allowlist carve-out, and SHALL contain no job, path filter or step whose only purpose is a Bash suite,
    a shell library or a shell-only check. `.gitlab-ci.yml` SHALL be regenerated from `ci/ci-capabilities.yml`
    by the generator and `check-ci-parity` SHALL pass with no shell entry in its expected output.
16. **JavaScript left outside the TypeScript tree.** The Oxfmt scope decision of #1321 SHALL be closed
    here: every tracked `*.js`, `*.mjs` and `*.cjs` file that parent requirement 16 allows (the Node.js
    floor guard and tool configuration) SHALL be formatted by `oxfmt --check`, and a tracked file that the
    scope excludes SHALL be listed in the audit report with its reason. The decision rule is: formatted
    unless the third-party tool that consumes the file defines its own formatting.

### Ratchet, termination and audit

17. **Allowlist empty, ratchet alive.** `ci/shell-allowlist.txt` SHALL contain no entry, header comments
    allowed. The ratchet check (`scripts/check-ratchet.ts` and its CI job) SHALL keep running and SHALL
    fail a pull request that adds a tracked `*.sh` file or a file whose shebang names `bash` or `sh`,
    and SHALL fail a pull request that adds an allowlist entry, so no shell file can be excused (parent
    requirements 10 and 12). The ratchet SHALL also still reject a tracked JavaScript or Python file outside
    the sets parent requirements 11 and 16 allow.
18. **No other shell path.** On the release branch head: a scan of tracked files for `*.sh` and shebangs
    SHALL find none; a search of `hooks/*.json`, `Taskfile.yml`, `.github/workflows/*`, `.gitlab-ci.yml`,
    `ci/**`, `docs/**`, `README.md`, `AGENTS.md` and every `SKILL.md` and `AGENT.md` for the word
    `bash` or `sh` followed by a space, and for `.sh`, as an invocation SHALL find only occurrences classified in the audit report as
    historical prose (a removed path named in the migration table or a spec) and none as a live invocation.
19. **Audit report.** A single report, committed under `docs/` and linked from #1344, SHALL contain: every
    spec of epic #1231 (`0215` and its deltas, and every sub-spec named in the epic table of #1231) with its `status`; every follow-up issue
    opened by a row with its state; every accepted gap with the owner who can act on it; the proof of
    requirement 18 as the output of the commands of the _Verification_ list; and the termination
    checklist of parent requirement 25 with one line per condition and the evidence. The report SHALL
    list #1601 (Windows plugin-root hook measurement, `docs/cli-matrix.md` row 37g, NOT MEASURED) as an
    accepted owner-actionable gap whose owner is the maintainer with a Windows machine; the report and
    `docs/cli-matrix.md` SHALL NOT mark the row measured, and no pull request of this row SHALL claim it.
    Any other gap SHALL carry the same three fields: evidence that the mechanism is absent, owner, issue.

### The final release-to-main pull request

20. **Merge commit.** The single pull request that merges `release/1231-ts-migration` into `main`
    (parent requirement 37, as modified by the _Parent changes_ section) SHALL be merged with a merge
    commit, never squashed or rebased, so that `cad08ac64d30dcd3ed96b4aadaf156ed7673abae` and
    `3ef0e4d03c443736efe75a659a0751478ab377a8` are ancestors of `main`
    (`git merge-base --is-ancestor` for each against the merge result exits 0). The pull request SHALL
    NOT be opened before the conditions of parent requirement 37 hold, SHALL carry the closing directive
    for #1231, and SHALL be prepared by this row but NOT merged by it: the merge is the owner's act with
    the user's permission asked immediately before (`AGENTS.md` → _Branching Strategy_).
21. **Body of the final pull request.** The body SHALL contain: an epic summary (rows, specs, counts of
    shell files removed, the empty allowlist); the release-notes entry of requirements 8 to 11; the
    publish note: `release-monorepo.yml` runs `node scripts/monorepo-release.ts`, the first real publish
    through the TypeScript driver happens on the first push to `main` after the merge, and the rollback
    is the revert of the switch squash `fd8eb13`; the sync-recovery statement of requirement 12; the link
    to the audit report; and the open gap of #1601.
22. **No faked measurement.** A statement in the release notes, the migration document or the audit report
    about the behaviour of a CLI that the author did not measure SHALL say `NOT MEASURED` and name the
    issue that tracks it; the Windows parity claim of row 37g stays as it is.
23. **Spec statuses at the end.** The last pull request of this row SHALL flip the `status` of this spec
    to `implemented` and SHALL NOT flip the status of a sibling whose own row has not terminated;
    status triggers follow `docs/spec-format.md` → _Lifecycle states_ and are not changed here.

### Gating on the unmerged rows

24. **Re-derive, do not copy.** I2 (#1339) and J2 (#1343) are unmerged at authoring time. This spec EXPECTS
    them to leave: from I2, `scripts/lib/model-resolve.sh`, `scripts/check-model-mappings.sh`,
    `scripts/check-agent-profiles.sh`, `scripts/build-ci.sh`, `scripts/check-ci-parity.sh`,
    `scripts/reserve-spec-id.sh`, `scripts/check-spec-id-reserved.sh`, `scripts/ci-cache-guard.sh`,
    `scripts/ci-changeset-coverage.sh`, `scripts/merge-spec-pr.sh` and `scripts/sweep-en-us.sh` as shims
    or as shell, per what I2 decides; from J2, the Bash suites of `scripts/tests/test-*.sh` listed in the
    allowlist, `scripts/test-build-components.sh`, `scripts/tests/fixtures/release/generate-github-golden.sh`
    and the harness-curator `test.sh`. Each removal pull request of this row SHALL start by rebasing on
    the release branch head and regenerating its removal list from `ci/shell-allowlist.txt` at that time,
    classified per requirements 6 and 7. A shell file present in the allowlist but not named in this spec
    SHALL be handled by the same rules (consumers deleted or rewritten first, then the file); a file named
    here but already gone SHALL be skipped. No removal pull request SHALL start while a row that owns one
    of its files is unmerged, unless the file is named in requirement 24 and its owner has confirmed on its
    own issue that the file is left to J4.
25. **Slicing.** The implementation SHALL be delivered as the following pull requests, in this order, each
    cut from `origin/release/1231-ts-migration`, each on a `test/1344-<slug>` branch, except the last,
    which uses `feat/1344-<slug>` because it flips this spec's status (the branch-prefix lint demands
    `status: implemented` for `feat/`):
    1. _docs-trace-shell-rules_ — requirement 5's documentation, `trace-gemini-p.sh` and the
       shell-only checkers with their tests and CI wiring: lowest risk, no runtime effect.
    2. _taskfile-ci-retarget_ — requirements 13 to 16: after this, nothing in CI or Taskfile names a
       shell file, so every later deletion is a pure deletion.
    3. _shim-removal-class-c-a_ — Class C then Class A shims with their forwarding tests and the
       migration document (requirement 8, 11): adopter-visible, one release-notes entry.
    4. _shim-removal-class-b_ — Class B shims, the recognition corpora and the cli-matrix measurement
       (requirements 9, 10), kept apart because a mistake here silently disables a guard.
    5. _library-retirement_ — requirements 3 and 4 with `common.sh` last: largest deletion, depends
       on the suites of J1b and J2 being gone.
    6. _empty-allowlist-and-status_ — requirements 17 to 19, the sync recovery rehearsal (12) and the
       status flip: the terminal act; also prepares the final release-to-main pull request body (21).

## Scenarios

**Scenario:** The allowlist is empty and the ratchet still rejects a new shell file

Given the release branch head after the last pull request of this row, with `ci/shell-allowlist.txt` holding only comments
When a pull request adds `scripts/helper.sh`, or an extensionless file whose first line is `#!/usr/bin/env bash`, and the ratchet job runs
Then the job fails naming the file; and when the same pull request instead adds the path to the allowlist the job still fails; and a pull request that adds only `.ts` files passes

**Scenario:** An adopter with a legacy hook line re-runs setup after the shim removal

Given an adopter whose `~/.claude/settings.json` carries `bash "<checkout>/hooks/worktree-git-guard.sh"` and whose checkout has been updated to the final merge
When the adopter's hook fires before setup is re-run, and then the adopter runs setup
Then the first firing fails with a missing-file error that the release notes describe in advance, and the setup run rewrites the line to `node "<checkout>/hooks/worktree-git-guard.ts"`, reports the rewrite, and a second setup run writes nothing

**Scenario:** Sync recovery after the final merge

Given `main` carries the merge commit of the final pull request, `scripts/sync-from-upstream.sh` no longer exists, and an adopter whose copy of `sync-from-upstream.ts` is defective
When the adopter runs `git checkout cad08ac64d30dcd3ed96b4aadaf156ed7673abae -- scripts/sync-from-upstream.sh` and then the restored script
Then the checkout resolves because the commit is an ancestor of `main`, the shell script reconciles `scripts/sync-from-upstream.ts` and `scripts/lib/sync-from-upstream/` with upstream, and a further sync is a no-op

**Scenario:** The final pull request would be a squash

Given the final pull request is ready and the repository allows squash merging
When the merge is prepared with the squash method
Then `git merge-base --is-ancestor cad08ac64d30dcd3ed96b4aadaf156ed7673abae <main>` fails on the rehearsal clone, and the pull request SHALL NOT be merged that way; the merge commit method is the only accepted one

**Scenario:** The Taskfile contains no shell

Given the `Taskfile.yml` after the retarget pull request
When every `cmds`, `cmd` and `sh:` value is scanned for `bash`, `sh` followed by a space, `.sh` and the POSIX-only utilities of requirement 23, and `task lint` is run
Then the scan finds none, `oxlint --type-aware` and `oxfmt --check` run and fail on an injected defect, and no task needs the task runner for a user-facing install path

**Scenario:** The audit report records the Windows gap without faking it

Given every row has landed and the Windows plugin-root measurement of #1601 has not been taken
When the audit report is generated and `docs/cli-matrix.md` row 37g is read
Then the report lists #1601 as an accepted gap with the maintainer as owner, the row still reads NOT MEASURED in all four cells, and no requirement of parent 25 is checked against a measurement that does not exist

**Scenario:** A leftover file not named in this spec

Given the allowlist, regenerated at the time of the shim-removal pull request, holds `scripts/foo.sh` that neither this spec nor I2 or J2 named
When the author applies requirement 24
Then the file is classified by requirement 7, its consumers are removed first, and the file is deleted in the same pull request as its last consumer, with no amendment to this spec

**Scenario:** Cron entry left on a machine

Given a Linux machine whose crontab holds the `# crewrig-harness-curator` marker and a command naming `curate.sh`
When the `curate.sh` shim is gone and the job fires
Then it fails and logs to `~/.local/state/crewrig/harness-curator.log`; the release notes describe the `crontab -e` removal, and no CrewRig code has touched the crontab

## Parent changes

- **Delta needed: `specs/0215-shell-to-typescript-migration.delta-06.md`** (not written here). Parent
  requirement 37 leaves the merge method to the owner; the owner has decided it
  (<https://github.com/crewrig/crewrig/issues/1231#issuecomment-6087488677>): merge commit only, because
  the recovery of requirement 12 depends on `cad08ac…` staying an ancestor of `main`. That modifies a
  normative statement of delta-04, so it goes through delta-06 (MODIFIED R37: "merge commit, never
  squash or rebase"), merged before the final pull request is opened. Requirement 20 of this spec is the
  statement the delta cites.
- **No delta needed** for R9 (shims "removed no later than the final sub-spec": consistent), R25 (its
  "no hook file ... invokes a shell script" holds once requirement 9 has rewritten installed lines and
  the tracked hook JSON files are already `node` commands), R15 and R26 (this spec applies them).
  Deltas 01 to 05 were read; none changes these requirements except as above. The plan MAY find that
  "setup SHALL rewrite" of R15 needs a statement for lines setup cannot recognise (operator-edited
  lines); if so it is a second modification of delta-06, not of this spec.

## Decision record

- **D1. Remove every shim; keep no stub.** Alternatives rejected: (a) keep Class B shims one more
  release as a non-shell file at the same path: a file named `*.sh` is a tracked shell path and the
  ratchet of requirement 17 fails; (b) keep a deprecation shim that prints a message: same objection and
  violates parent requirement 25; (c) a native `command-not-found` hook in setup: no mechanism exists in
  the four CLIs. The cost, a failing legacy line until setup is re-run, is documented (requirement 10).
- **D2. Crontab is a documented manual step.** Alternative rejected: a cleanup in setup that reads and
  rewrites the crontab: requires spawning `crontab`, forbidden by parent requirement 23, and an edit of a
  user's own schedule is a higher-risk write than the problem it removes. The failure is loud, logged and
  confined to one optional feature.
- **D3. Rewriter keeps recognising `.sh` forms.** Alternative rejected: drop the legacy corpus entries
  with the shims: setup would then leave a legacy line untouched and report it as foreign, so the
  adopter keeps a dead hook.
- **D4. Ratchet kept, allowlist emptied.** Alternative rejected: delete the ratchet with the last shell
  file: parent requirement 10 asks for a check that fails when a shell file is added, and without it the
  invariant has no guard after the epic.
- **D5. Libraries and test ports retire together.** Alternative rejected: keep the oracle libraries as
  a permanent reference: they are shell files, they would hold the allowlist non-empty, and every twin is
  already proved against recorded tuples (spec 0261).
- **D6. Six pull requests, Taskfile and CI first.** Alternative rejected: one large removal pull request:
  one defect in the Class B group would force a revert of everything; and doing the shim removal before
  the CI retarget would leave CI jobs that call deleted files.
- **D7. Gating by re-derivation.** Alternative rejected: a frozen file list in this spec: I2 and J2 will
  change the leftover set after this spec merges; a frozen list would then be wrong in one direction or
  the other and would need a delta for each change.
- **D8. Oxfmt scope for JavaScript.** Alternative rejected: leave all JavaScript outside the format check:
  the files that remain are few, and an unformatted island is exactly a "carve-out" in the sense of the
  #1344 comment.
- **D9. #1601 stays a recorded gap.** Alternative rejected: infer Windows behaviour from rows 37 to 37f:
  those measured project-directory tokens, not plugin-root tokens, and spec 0258 requirement 21 forbids
  shipping a hook that does real work on an unmeasured cell.

## Observable acceptance and verification

Acceptance is observable on the release branch head after the last pull request of this row: the
ratchet job is green with an empty allowlist and red on an added shell file; the audit report exists
and every parent-25 condition has evidence; the final pull request body is complete and unmerged.

| Requirement | Command or check that proves it                                                                                                                                              |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1-5         | `git ls-files '*.sh'` is empty; `git grep -l 'bash32\|pipefail-grep\|lint-shell\|shellcheck'` lists only the migration table and specs                                       |
| 6-8         | `git ls-files` shows none of the paths of `docs/shell-removal.md`'s table; `node --test` runs the migration-table test (every row's replacement exists)                      |
| 9-10        | `node --test scripts/tests/*hook*rewrite*.test.ts` (legacy `.sh` line to `.ts`, second run writes nothing); `docs/cli-matrix.md` cell per CLI                                |
| 11          | `git grep -n 'crontab' scripts hooks` finds no spawn; the release notes carry the marker text                                                                                |
| 12          | rehearsal log: `git checkout cad08ac… -- scripts/sync-from-upstream.sh`, restored script run twice, second run no-op                                                         |
| 13-16       | `node scripts/check-taskfile-commands.ts` (scan of every task); `task lint` and `task format-check` green; `git diff` of the generator output empty; `check-ci-parity` green |
| 17          | `node scripts/check-ratchet.ts` exit 0 on head, exit non-zero on a scratch tree with an added `.sh` and with an added allowlist line                                         |
| 18          | `git ls-files` plus a shebang scan; `git grep` for the words bash and sh followed by a space, and for the suffix .sh, over the paths of requirement 18, every hit classified |
| 19          | the audit report; `gh issue list --label` states of the follow-ups; row 37g unchanged                                                                                        |
| 20-21       | `git merge-base --is-ancestor <sha> <merge-result>` for both commits on a throwaway clone; the body's checklist                                                              |
| 24-25       | each removal pull request body shows the regenerated list and its classification                                                                                             |

## Out of scope

- Writing `specs/0215-shell-to-typescript-migration.delta-06.md`; this spec only names it.
- Merging the final release-to-main pull request, deleting the release branch, removing its ruleset and
  reverting worktrees to `main` (parent requirement 37 gives these to the owner).
- Work owned by I2 (#1339) and J2 (#1343) until they merge; requirement 24 only says what this row does
  with what they leave.
- The Windows plugin-root hook measurement of #1601, a flaky-test fix (#1599, #1545, #1611) and the
  `node_modules` in the extension release archive (#1599).
- Any crontab write, any interception of a legacy shell invocation, and any new shim.
- Changing the behaviour of a migrated script, the golden fixtures that are not named by a retired shim,
  or the `Taskfile.yml` as a convenience layer beyond the commands it invokes.
- Flipping the status of a spec of another row.

## Open questions

- Does the final-merge rehearsal of requirement 12 run in CI (a throwaway clone) or as a recorded manual
  rehearsal? Decision proposed: a recorded manual rehearsal with the command log attached to #1344, since
  the final merge result does not exist until the owner prepares it.
- Does `lint-shell.sh` still exist anywhere on the release branch? The #1611 hand-off says it is already
  gone, but `ci/shell-allowlist.txt` still lists it at authoring time; the plan resolves this by reading the
  tree, and requirement 5 applies either way.
- Whether the plan finds a Class B line whose CLI treats a missing hook file as blocking (requirement 10);
  if so the release-notes wording becomes a warning, not a note.

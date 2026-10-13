---
id: "0257"
slug: packaging-release-typescript
status: draft
complexity: standard
interaction-mode: MINIMAL
related-issue: 1336
version: 1.0.0
---

# Documentation index, extension packaging and monorepo release in TypeScript

*Sub-spec G2 of the `large`-tier ticket #1231, row G2 of the architect
decomposition
(<https://github.com/crewrig/crewrig/issues/1231#issuecomment-5857477069>).
Parent spec: `specs/0215-shell-to-typescript-migration.md` (requirements 7, 9, 13,
14, 17, 21, 22 and 23, row G, as ordered by
`specs/0215-shell-to-typescript-migration.delta-01.md`), under the release-branch
regime of `specs/0215-shell-to-typescript-migration.delta-04.md` (requirements
27-38): this spec-PR and its implementation pull requests target
`release/1231-ts-migration`, "shipped" means merged there, not reached `main`, and
the base ref wherever a protocol names `main` is `origin/release/1231-ts-migration`
(requirement 34). Requirement 23 of the parent applies as narrowed by
`specs/0215-shell-to-typescript-migration.delta-05.md`. Depends on sub-specs A2
(`specs/0240-runtime-foundations-shared-ts-modules.md`: `scripts/lib/paths.ts`,
`tmp-file.ts`, `line-endings.ts`, `require-dependency.ts`, `node-floor-guard.js`, the
entry form and the `windows-latest` job conventions), G1a
(`specs/0250-component-build-core-typescript.md`), G1b
(`specs/0254-extension-plugin-builders-typescript.md` and its delta-01: the extension
builder `scripts/build-extension.ts`, `scripts/lib/extension/*`, and requirement 30,
the real-copy staging of `js-yaml` and `argparse` in the release clone), F2
(`specs/0255-install-manage-link-typescript.md`: `scripts/lib/link-or-copy.ts`, the
shim form of its requirement 25) and F1
(`specs/0256-setup-entry-points-typescript.md`, which completes step (b)). It
inherits the behavioural contracts of `specs/0183-extension-model-migration.md` and
its delta-01 (Ruling A: the release archive serves the Gemini CLI alone),
`specs/0213-gitlab-release-publisher.md` and its delta-01 (one release engine, both
forges), `specs/0044-extension-version-lockstep.md`, `specs/0027-docs-publication-contract.md`
and the release-PR flow of issue #1379 (`docs/github-release-pr.md`).*

## Intent

A maintainer, a release workflow and a documentation contributor run the same six
commands as today, and get the same files, the same lines on the terminal and the
same exit statuses, except for the few listed changes. The documentation index is
regenerated, or checked for drift, with the same lint messages. A single extension,
or every extension of the upstream tiers, is packaged into the same one-asset
archive that the Gemini CLI installs. The monorepo release analyses and releases
every extension on GitHub or GitLab, in publish mode or as a credential-free
rehearsal, printing the same `PUBLISHED`, `PENDING`, `UNCHANGED`, `REHEARSAL` and
`RELEASE-FAILED` lines. All of it runs on Windows from PowerShell with no POSIX
shell, `jq`, `tar`, `sha256sum`, `awk` or `sed` on the machine, and the release
chain keeps working when it next runs on `main`.

<!-- markdownlint-disable MD029 -->

## Requirements

### Entries and structure

1. **Entry points.** Five TypeScript entries SHALL replace the behaviour of six shell
   scripts, each at the path of its predecessor with `.sh` changed to `.ts` (parent
   requirement 9, spec 0240 requirement 11): `scripts/build-docs-index.ts`,
   `scripts/package-extension.ts`, `scripts/package-extensions.ts`,
   `scripts/release-package-extension.ts` and `scripts/monorepo-release.ts`. The sixth
   script, `scripts/lib/monorepo-release-lib.sh`, has no entry: it is a sourced
   library that requirement 22 retires. One helper entry with no shell predecessor,
   `scripts/release-sync-manifests.ts`, SHALL carry the manifest synchronisation of
   requirement 16. Each entry SHALL be runnable as a direct
   `node` command line, written to the conventions of parent requirement 2, and
   SHALL follow the entry form of spec 0255 (a thin CommonJS-form file with no
   top-level `import` or `export`, `process.exitCode` instead of `process.exit`, the
   logic under `scripts/lib/`).

2. **Module layout.** The logic SHALL live under three directories, each file under
   300 lines (spec 0238): `scripts/lib/docs-index/`, `scripts/lib/packaging/` (the
   release packager, the single-extension and every-extension entries, the manifest
   synchronisation and the archive writer) and `scripts/lib/monorepo-release/` (forge, mode, branch,
   identity, credential, release configuration, mirror, rehearsal, publish and
   GitHub release-PR flow, one concern per file). A module that two entries need
   SHALL be imported, never duplicated.

3. **Reuse.** The migration SHALL reuse what ships on the release branch and SHALL
   NOT re-implement it: `scripts/build-extension.ts` and `scripts/lib/extension/*`
   (manifest reading, current-shape assertion, build directory, the gemini render;
   spec 0254), `scripts/lib/link-or-copy.ts` (spec 0255), `scripts/lib/paths.ts`,
   `tmp-file.ts` and `line-endings.ts` (spec 0240), `scripts/lib/require-dependency.ts`,
   `scripts/release-pr.ts` and `scripts/lib/release-pr.ts` (spawned as today),
   `scripts/lib/release-rehearse.mjs` and `scripts/lib/release-notes/*` (unchanged,
   including the `.mjs` files grandfathered in `ci/js-baseline.txt`; no JavaScript
   file is added). The PLAN SHALL list, per module, what it imports.

4. **Observable contract.** Each entry SHALL preserve the observable contract of the
   script it replaces — arguments, environment variables read, exit codes, standard
   output, standard error and files written (parent requirement 14) — except for the
   deviations of requirement 31, which is a closed list.

### Documentation index (`build-docs-index`)

5. **Same lint, same manifest.** `scripts/build-docs-index.ts` SHALL scan
   `docs/**/*.md`, extract the first `crewrig-doc` comment after the page's first
   level-1 heading, parse it with the shell's tokenizer, apply the shell's lint
   rules in the shell's order, and emit `docs/index.json` byte for byte as the shell
   emits it: fixed eight-section order, rows sorted by `nav_order` (numeric, exact on
   any digit count) then path, a single trailing line feed. Every lint message, the
   `Documentation publication contract violations:` header, the `Wrote` and `OK`
   lines and the exit codes 0, 1 and 2 SHALL be unchanged.

6. **Ordering.** Paths and rows SHALL be ordered by byte value of their UTF-8
   encoding, which is what the shell produces under `LC_ALL=C`; the proofs run the
   shell under `LC_ALL=C` (deviation (e)).

7. **Check mode.** `--check` SHALL regenerate in memory, compare with the committed
   `docs/index.json` and exit 1 on a missing or stale file, after the same
   orphan-path check; the drift report SHALL show the differing lines (deviation (c)).

8. **Line endings.** Page files with LF or CRLF line endings SHALL parse to the same
   rows; the written `docs/index.json` SHALL have LF line endings on every
   operating system (parent requirement 22).

### Packaging (`release-package-extension`, `package-extension`, `package-extensions`)

9. **The release packager.** `scripts/release-package-extension.ts <name> --version
   <v> --out <dir>` SHALL keep the shell's argument handling, tier resolution
   (`core`, `library`, `org`; a name in two tiers is refused) and its five assertions
   in the shell's order, each with its message: the current declaration shape; a
   fresh `--target gemini` render; `gemini-extension.json` at the root of
   `build/extensions/<name>`; the built version equal to `--version`; and an empty
   output directory (exactly one asset). The render SHALL be the G1b builder of
   requirement 3. Where the `gemini` CLI is on the path, `gemini extensions validate`
   SHALL still run as a non-fatal check; spawning a supported CLI is permitted.

10. **The archive.** The release archive SHALL be `<out>/<name>-<version>.tar.gz`, a
    gzip stream of a tar stream whose entries are the contents of
    `build/extensions/<name>` with no wrapper directory (Ruling A, the R20 probe), at
    the same paths the shell's `tar -czf <archive> -C <build> .` stores, `./`
    prefix included. It SHALL be written by an in-house writer over `node:zlib`
    (Decision D1); the decompressed stream SHALL be a pure function of the
    tree, in the form of requirement 11, and `gzip`, GNU `tar`, `bsdtar` and the Gemini
    CLI installer SHALL all extract it.

11. **Archive determinism.** The writer SHALL emit entries in byte order of their
    path; directories before their contents; fixed modification time, owner and group
    (zero, empty names); mode `0755` when any execute bit is set and `0644` otherwise
    (directories `0755`); regular files and directories only (any other file type,
    a symbolic link included, fails the run naming the path, deviation (a)); a PAX extended header for a path
    that does not fit the ustar name and prefix fields; the gzip header with a zero
    time, and byte 9 (the operating-system byte) set to the Unix value after
    compression, whatever platform runs it. On a platform
    that reports no execute bit (Windows) a file SHALL get mode `0755` when its first
    two bytes are `#!`. The refusal of a symbolic link keeps the archive path from
    creating or following a link (parent requirement 21). Two runs on the same
    tree SHALL yield the same decompressed stream on every platform.

12. **Single and every extension.** `scripts/package-extension.ts` SHALL read `EXT`
    from the environment, resolve its tier, read `.version` of its `extension.json`,
    clear `dist/release/<EXT>` and run the packager in the same process. The
    environment variable `EXT`, the messages and the exit codes SHALL be the
    shell's. `scripts/package-extensions.ts` SHALL package every extension of the
    `core` and `library` tiers in byte order of name, and the `org` tier too after
    `--include-org` or with `INCLUDE_ORG` set non-empty; it SHALL stop at the first
    failure, as the shell's `set -e` does.

### Release driver (`monorepo-release`)

13. **Preflight.** `scripts/monorepo-release.ts` SHALL resolve, in this order, the
    forge (Gitea Actions refused first; GitHub and GitLab both set refused as
    ambiguous; none and unknown CI refused), the mode (`RELEASE_DRY_RUN`, alias
    `DRY_RUN`, `true`, `false` or empty only; `true` wins), the branch (the checked
    out branch on GitHub; `CI_COMMIT_BRANCH` on GitLab, a merge-request or tag
    pipeline refused), the identity (the four `GIT_*` values defaulted on GitHub
    only), the forge variables, the refusal to publish from a `release-pr/*` branch
    and, in publish mode, the credential (`GITHUB_TOKEN`, `GH_TOKEN`, else
    `RELEASE_TOKEN`; the GitLab equivalents). Every refusal SHALL print
    `Error: <reason>` on standard error and exit 2 before any file is written or any
    engine call is made, with the shell's exact reasons.

14. **Modes and flows.** The three flows SHALL keep their sequence, their output
    lines and their exit status (0, or 1 with `Release analysis completed WITH
    ERRORS.`): GitLab publish (one `npx semantic-release` per extension, its output
    teed to a log, the failed step and the created tag read from that log, the
    credential helpers disabled); GitHub publish, the release-PR flow of issue #1379
    (classification by the engine's dry run into `unchanged`, `publish` and
    `pending`, publication of the merged releases from the checkout, preparation of
    the pending ones in the clone, force-push of the release branch, then
    `scripts/release-pr.ts sync`); and rehearsal (a throwaway mirror and clone, one
    engine process per extension through `scripts/lib/release-rehearse.mjs`, the
    package step, the `REHEARSAL` line and the release note). The checkout's refs,
    index, working tree and ignored files SHALL be left as found.

15. **The engine configuration.** The generated `.releaserc.json` SHALL keep the
    shell's structure — the analyzer rules, the gitmoji facade, the changelog
    facade, `@semantic-release/exec` before `@semantic-release/git` (spec 0044), the
    publish leg per forge and mode, the GitLab notes leg, `tagFormat`, `branches`,
    `repositoryUrl` — with its keys in the shell's order and the shell's messages
    (`[skip ci]` kept on every non-prepare commit). Compared with `jq -S .` it SHALL
    equal the shell's output for every forge and mode, except for the two command
    strings of requirement 16 (deviation (b)).

16. **The prepare commands.** The `prepareCmd` of `@semantic-release/exec` SHALL no
    longer invoke `bash` or `jq` (parent requirement 7, requirement 23). In publish
    and rehearsal modes it SHALL be `node "<root>/scripts/release-sync-manifests.ts"
    <v> && node "<root>/scripts/release-package-extension.ts" <name> --version <v>
    --out "<out>"`, and in `prepare` mode `node
    "<root>/scripts/release-sync-manifests.ts" <v>` alone (Decision D2), with bare
    `node`, double quotes and `&&` only, which `sh -c` and `cmd.exe` both accept;
    `<v>` is the engine's own `${nextRelease.version}` template or, in the
    rehearsal, the validated literal version. The generation of the configuration
    SHALL refuse a `<root>` or `<out>` that holds a double quote, a percent sign, an
    exclamation mark, a dollar sign, a backtick, a backslash or a line break, after, on
    Windows only, the path separators have been written as forward slashes, which `node`
    and `cmd.exe` both accept, so that a native drive path is not refused; a UNC path
    SHALL be refused naming the path (on any other platform a backslash is a character
    of the name and is refused). The synchronisation SHALL rewrite
    `version` of `package.json` and `extension.json` of the current directory when
    each exists, two-space indented with a trailing line feed, SHALL exit non-zero
    when a rewrite fails, and SHALL succeed in a directory with no `extension.json`.
    A clone's own packager SHALL run in the rehearsal, as today.

17. **Mirror and clone.** The rehearsal and the GitHub flow SHALL build a bare mirror
    of HEAD and its tags, reconcile the remote `*-v*` tags whose commit is local and
    an ancestor of HEAD, and clone it with the forge URL redirected to the mirror by
    `url.<mirror>.insteadOf`, spawning Git only. Pushes from the checkout SHALL use
    `--no-verify`. The clone's `node_modules` SHALL be a real directory holding real
    copies of `js-yaml` and its closure (`argparse`) and, for every other entry, a
    link made by `scripts/lib/link-or-copy.ts` (requirement 30 of spec 0254's
    delta-01, kept; Decision D4).

18. **Credentials.** Every exported variable whose name matches the release core's
    masking rule (`token`, `password`, `credential`, `secret`, `private`, any case)
    or is `CI_REPOSITORY_URL` SHALL be removed from the environment of each
    rehearsal and preparation engine process, which SHALL still refuse to run when
    one is present (exit 2, names only). A credential value SHALL never be printed;
    it SHALL be named on refusal only.

19. **Cleanup.** One scratch directory per run SHALL be removed on exit, on an error
    and on an interrupt; in GitLab publish mode only what the run created under
    `dist/` SHALL be removed.

### Retiring the library and the oracles

20. **No new tool.** The six entries SHALL spawn only `git`, `node`, `npx`, the
    `gemini` CLI where present, and the entries and `.mjs` files of this repository.
    They SHALL NOT spawn `jq`, `tar`, `gzip`, `sha256sum`, `shasum`, `awk`, `sed`,
    `grep`, `mktemp`, `ls`, `find`, `rm`, `env`, `bash` or `sh` (parent requirement
    23). JSON handling SHALL use the Node.js standard library; digests SHALL use
    `node:crypto`.

21. **Oracle suites.** `scripts/tests/test-build-docs-index.sh`,
    `test-release-package-extension.sh`, `test-monorepo-release-engine.sh`,
    `test-monorepo-release-notes.sh` and `scripts/tests/fixtures/release/generate-github-golden.sh`
    SHALL pass unchanged in their assertions against the TypeScript implementation
    through the shims, on Linux and macOS. No pull request SHALL both migrate a
    script and change an assertion of its Bash test (parent requirement 13). A
    sandbox that copies a script file SHALL be retargeted to copy the entry and its
    modules in a pull request that lands before the switch.

22. **The sourced library.** `scripts/lib/monorepo-release-lib.sh` is a sourced
    library; its oracle is the black-box tests of the driver. The tests that source
    it — `scripts/tests/test-monorepo-release.sh` (all of it but groups (f) and the
    workflow reads of (g), which read no library and carry over) and the in-process
    part of `test-monorepo-release-engine.sh` (the golden comparison of
    `emit_releaserc github publish`, case 11g) — SHALL be retired in the switch pull
    request under the first bounded exception of parent requirement 13 (Decision
    D3); the black-box remainder of the engine suite keeps its assertions unchanged.
    Before that pull request every behaviour they assert SHALL be covered by an
    unchanged black-box test of the driver that runs the shell driver and then the
    TypeScript one: a TypeScript suite that runs the driver in a sandbox with a
    capturing `npx` stub and a capturing `release-rehearse.mjs` stub, recording the
    generated configuration, the environment the engine would see and the exit status.
    The retired groups, named as in the header of `test-monorepo-release.sh`, and
    their substitutes are:
    (a) each forge-detection refusal — the driver's refusal output and exit 2, with no
    stub call and no configuration written; (b) the `RELEASE_DRY_RUN` and `DRY_RUN`
    matrix and the GitLab merge-request and tag refusal — the driver's output and exit
    status, and the mode seen through the stubs; (c) the GitHub publish configuration
    against its golden, and the identity defaults and override — the configuration the
    `npx` stub captures and the `GIT_*` variables it sees; (d) the GitHub and GitLab
    structure, publish and rehearsal — the configurations the stubs capture in each
    forge and mode; (e) the credential rules — a driver run with every credential-named
    variable set, the engine stub's environment and the output lines, and the
    `release-rehearse.mjs` refusal, whose file is unchanged and keeps its own
    assertion; (f) the GitLab document carries no `extensions install` command — a
    text read of a document, kept as is; (g) the classification table, the `prepare`
    configuration, the release-PR branch name and the manifest synchronisation —
    the rehearsal stub's answers against the driver's `UNCHANGED`, `PENDING` and
    publish lines, the branch pushed to the sandbox origin and the manifests the
    prepare commands rewrite, run for real; the workflow-permission reads of (g) are
    kept as is; and the engine suite's case 11g — the real engine's rendering of the release note from
    the captured GitHub publish configuration, publish leg removed, against its rendering
    from the golden configuration, byte for byte, with the shell's vacuity guard kept. The parsers of the failed step, the created tag and
    the version check are reached through the same lines. Every group is thus covered
    at the consumer level; no unit test stands in for a group. The PLAN SHALL name
    each substitute test by file and case. The shell library SHALL NOT remain as a
    shim.

23. **Static reads.** Every file that reads the text of a migrated script — Bash
    suites that `grep` or `source` it, `Taskfile.yml` `cmd:` entries, workflow and
    `ci/ci-capabilities.yml` `run:` lines, the allowlists
    `scripts/tests/fixtures/*/old-invocation-allowlist.txt`, documentation — SHALL be
    enumerated in the PLAN and retargeted in pull requests that land before the
    switch, with a before and after list and a vacuity guard, except what the switch
    itself replaces (requirement 28).

### Proof

24. **Differential proof.** A TypeScript test SHALL run, for every entry, the shell
    and the TypeScript implementation on the same fixtures and compare standard
    output, standard error, exit status and every file written, under `LC_ALL=C`;
    each difference SHALL carry a deviation tag of requirement 31 and an untagged
    difference SHALL fail. Goldens SHALL be generated in a Linux container mirroring
    the CI runner and regenerated in a second image with Node under a runner-like
    path, `diff -r` empty, with host-specific values normalised and a `.golden`
    suffix on every stored file.

25. **Archive proof.** The archive of the shell and the archive of the writer SHALL
    list the same paths with the same modes (modulo requirement 11), and the same
    contents byte for byte; the extracted tree SHALL equal a fresh render (`diff -r`,
    as `test-release-package-extension.sh` asserts); a golden SHALL pin the sha256
    of the decompressed tar stream of a fixture tree.

26. **Release proof without a release.** Every proof of the release driver SHALL run
    against a sandbox remote and a stubbed `gh`; no test SHALL create a real tag,
    release or push. Before the switch, a CI job SHALL run the shell and the
    TypeScript driver in rehearsal mode on the real repository checkout and require
    the same output once the archive hash and scratch paths are normalised, and the
    PLAN SHALL say how a release run is exercised before the switch. That job, or the
    archive proof of requirement 25, SHALL also assert that no extension build tree
    holds a symbolic link.

27. **Windows.** The pull request that adds the entries SHALL add a `windows-latest`
    job, declared in `ci/ci-capabilities.yml` and mirrored in the generated
    workflows, that runs from PowerShell: the documentation index (write, check,
    drift, lint failure); the release packager and `package-extension(s)` on a sandbox
    copy of the repository, listing and reading the archive with the in-house reader;
    and the release driver (every refusal with exit 2, and a rehearsal against a
    hermetic fixture repository), asserting files, lines and statuses, with no
    `bash` on the narrowed path and no carriage return in a written file. The proof
    SHALL be written under the rules of spec 0255 requirement 29.

### Switch, callers and cross-cutting

28. **Shims and callers.** In the switch pull request each of the five shell files
    SHALL become a forwarding shim of the form of spec 0255 requirement 25 (node
    presence check, `node-floor-guard.js`, `exec node <entry> "$@"`) and stay on
    `ci/shell-allowlist.txt` until row J4; `scripts/lib/monorepo-release-lib.sh` and
    its allowlist entry SHALL be removed. `Taskfile.yml` (`package`,
    `package-extension`), `.github/workflows/release-monorepo.yml`,
    `release-rehearsal.yml`, `ci/ci-capabilities.yml` and the workflows and
    `.gitlab-ci.yml` it generates, and the documentation naming the old invocation
    SHALL call the entries directly (the floor guard, then the entry), including
    `docs/cli-matrix.md`, `DEVELOPMENT.md`, `docs/publication-contract.md`,
    `docs/layers.md`, `docs/github-release-pr.md`, `docs/gitlab-release-publishing.md`
    and `docs/version-bump-convention.md`. A job or a trigger that lists the removed
    library SHALL list the new modules instead, a path trigger or cache key that names
    a migrated script SHALL also name its entry and `scripts/lib/**` modules, and a
    job that runs a migrated entry SHALL provide Node.js 24 and the dependency step
    (the `docs-index` job has neither today and the `release-notes` job runs Node.js
    22).

29. **Oracle mutation.** A suite that mutates the shell implementation in a sandbox
    SHALL also mutate its TypeScript twin, in a sandbox with `.git`, the root
    `package.json` and real copies of `js-yaml` and `argparse`; a nested
    `node --test` SHALL run with `NODE_TEST_CONTEXT` unset and every harness SHALL
    delete `CI` from the child environment.

30. **Parity, paths and line endings.** Every path SHALL be built with the platform-aware
    helpers of spec 0240; every input SHALL be accepted with LF or CRLF line endings;
    every committed generated file (`docs/index.json`) SHALL be byte-identical on
    every platform; no two paths SHALL differ only by letter case. The release
    archive serves the Gemini CLI alone (Ruling A, spec 0183 delta-01): the Claude
    Code, GitHub Copilot CLI and Antigravity CLI extension and plugin outputs keep
    their builders (spec 0254) and local render-and-install paths and are neither
    packaged nor changed here, which `docs/cli-matrix.md` SHALL record in the same
    diff that touches its rows 13 and 17.

31. **Deviations.** The only differences from the shell, in standard output, standard
    error and files written, SHALL be: (a) the release archive: sorted entries, fixed time, owner and group, normalised
    modes and a fixed gzip header where the shell stores the filesystem's order, times
    and modes in the host `tar`'s format, and the refusal of a symbolic link, which the
    shell archives (requirements 10, 11 and 25); (b) the two `prepareCmd` strings of
    the engine configuration, which no longer name `bash` or `jq`, and the manifest
    synchronisation formatting of requirement 16; (c) the body of the drift report of
    `--check`, a line diff without the headers and times of `diff -u`; (d) the
    `jq is required` and `tar is required` preflight messages, which cannot occur;
    (e) the ordering of paths, sections and extensions by byte value on every host
    (the shell's order follows the host locale); (f) the two lines the shim adds
    when `node` is absent or older than the floor (spec 0255 requirement 25); (g) one
    notice on standard error when a link in the release clone became a copy
    (parent requirement 21); (h) a prepare command that quotes its paths, where the shell leaves a path unquoted
    and breaks on a space, with the refusal of a root or output path that holds one of the
    characters of requirement 16; and a failed manifest rewrite that stops the run
    before packaging in publish and rehearsal modes, where the shell packaged
    regardless. Letters (i) onward are reserved for what the
    differential test finds, each added through a delta of this spec.

32. **Staging.** The work SHALL ship as: oracle hardening and black-box coverage of the
    driver; dark modules (archive writer and documentation index; packaging entries;
    release driver), each with its unit suites; the entries, the differential proof,
    the goldens and the Windows job; the retargeting of static reads; the
    switch (requirements 22 and 28); the status flip. Every implementation pull
    request but the last SHALL use a `test/1336-<slug>` branch, because the spec
    linter reads a `feat/`, `fix/`, `refactor/`, `perf/` or `chore/` prefix as the
    implementation-complete pull request and demands `status: implemented`; the last
    SHALL use `feat/1336-<slug>`. Every pull request targets
    `release/1231-ts-migration`.

### Decision record

**Decision D1 — archive production.** *Adopted:* requirements 10 and 11, an
in-house ustar writer with a PAX fallback, over `node:zlib`, one module of about 200
lines and its tests (an independent `architect` pass reached the same decision).
*Rejected:* (i) a `tar` npm package as a production dependency — it would add a
second production dependency and its tree to the install of every adopter, with the
entry order, times and modes still to be normalised by hand; it stays the fallback if
the writer outgrows 200 lines; (ii) spawning the host `tar` — GNU `tar` and `bsdtar`
write different headers, the determinism flags exist in GNU `tar` only, Git for Windows
can shadow `tar.exe` and reads `C:\...` as a remote host, and the closed list of
parent requirement 23 as narrowed by its delta-05 does not name it; (iii) `git archive`
— it archives a committed tree, not the untracked render in `build/`, and
`core.autocrlf` can rewrite content on Windows; (iv) `zip` — the installer resolves the
generic asset by the `.tar.gz` name (Ruling A, the R20 probe runbook). The deterministic
claim is made on the decompressed stream: deflate output across zlib builds is not
guaranteed.

**Decision D2 — the prepare command.** *Adopted:* requirement 16, two `node` command
lines over two entries joined by `&&`, so that the engine configuration keeps the same
plugin set, order and step attribution (`step=package` still reads `Failed step
"prepare" of plugin "@semantic-release/exec"`) and only a string changes. *Rejected:*
(i) keeping `jq` and `bash` in a command line (parent requirement 7 forbids a shipped
command line that invokes `bash`; requirement 23 forbids `jq`); (ii) an in-repo
semantic-release plugin replacing `@semantic-release/exec`, which an independent
`architect` pass recommended because no command string and no quoting would remain —
declined for this row because it changes the plugin set that specs 0044 and 0213 fix,
moves the failed-step attribution onto a plugin name that the shell parser must learn,
and the release chain cannot be exercised on a real forge before the final merge, so
the smaller change wins; it remains a candidate follow-up that this spec does not
preclude; (iii) one `--sync-manifests` option on the packager, which couples two
responsibilities and would make the `prepare` mode package; (iv) `node -e` with inline
code, whose quoting is fragile on both shells.

**Decision D3 — the sourced library.** *Adopted:* requirement 22, retirement in the
switch pull request with its in-process tests, after black-box coverage. *Rejected:*
a shell shim of the library that shells out to Node for each function (it would
re-implement environment mutation, `exit 2` and array globals in shell, a throwaway
asset of several hundred lines, and keep the in-process suites running against it
for a library that parent requirement 13 lets them retire with); keeping the
library for a later row (its last consumer is the driver of this row, so parent
requirement 8 retires it here).

**Decision D4 — links in the release clone.** *Adopted:* requirement 17, the
link-or-copy module with its copy fallback, so that parent requirement 21 holds for
every place that creates a link. *Rejected:* `onRefusal: "throw"`, which spec 0255
anticipated for this row — it fails a release on a machine that refuses links, when
the clone is a throwaway directory and a slower copy is correct; copying every
`node_modules` entry (needless on every platform that links).

## Scenarios

**Scenario:** The documentation index is regenerated from PowerShell

Given Windows with Node.js 24, a `docs/` tree with CRLF page files and no `bash`
on the path
When `node scripts/build-docs-index.ts` runs
Then `docs/index.json` equals the shell's output for the same tree, with LF line
endings, and `Wrote docs/index.json (<n> published pages).` is printed.

**Scenario:** A stale index fails the check

Given a committed `docs/index.json` that lacks one published page
When `node scripts/build-docs-index.ts --check` runs
Then it prints `Drift: docs/index.json is stale. Re-run: ...` and the differing lines
on standard error and exits 1.

**Scenario:** An extension is packaged into the one-asset archive

Given the `hello-world` extension at its committed version and an empty output
directory
When `node scripts/release-package-extension.ts hello-world --version <v> --out <dir>`
runs
Then `<dir>/hello-world-<v>.tar.gz` is the only file in `<dir>`, its first entries
are `./` and `./gemini-extension.json`, no entry has a wrapper directory, and
extracting it yields a tree equal to `build/extensions/hello-world`.

**Scenario:** A tree holding a symbolic link is refused

Given a build tree with one symbolic link
When the archive writer runs
Then the run fails naming the path of the link and no archive is written.

**Scenario:** Packaging refuses to run twice into one directory

Given an output directory that already holds a file
When the packager runs
Then it prints the one-asset error naming the directory on standard error, exits 1
and leaves the directory's file as it was.

**Scenario:** A version mismatch is refused naming both versions

Given a built manifest at version `A` and the argument `--version B`
When the packager runs
Then it exits 1 with an error that contains both `A` and `B` and writes no archive.

**Scenario:** The release driver refuses with no side effect

Given no CI environment variable
When `node scripts/monorepo-release.ts` runs
Then it prints `Error: unsupported release forge: none (not a CI environment)`, exits
2 and has made no engine call and written no file.

**Scenario:** A rehearsal publishes nothing

Given `GITHUB_ACTIONS=true`, `RELEASE_DRY_RUN=true`, a sandbox remote and a stubbed
`gh`
When the driver runs
Then for each extension it prints `UNCHANGED <ext>` or `REHEARSAL <ext> version=...
archive=... sha256=...` followed by the release note, no tag, release or push reaches
the remote, and the checkout is as found.

**Scenario:** The release clone keeps real copies of the YAML loader

Given a checkout whose `node_modules` holds `js-yaml`, `argparse` and other packages
When a rehearsal builds its clone
Then `js-yaml` and `argparse` in the clone are real directories, every other entry
is a link or, where the link was refused, a copy reported once, and the packaging
step loads `js-yaml` from the clone.

**Scenario:** The release driver rehearses from PowerShell on a native Windows path

Given Windows with a checkout under `C:\work\crewrig`, no `bash` on the path and the
development dependencies installed
When `node scripts/monorepo-release.ts` runs a rehearsal against a hermetic fixture
Then the generated configuration names the root and the output directory with forward
slashes, the package step succeeds, and the `REHEARSAL` line is printed.

**Scenario:** The Bash oracles pass through the shims

Given the shims installed and the library removed
When the five oracle suites run on Linux and macOS
Then every assertion passes unchanged.

**Scenario:** The release chain still runs on `main`

Given the release workflow calling the entry directly
When a push to `main` triggers it
Then it prints the same lines, opens or updates the release PR through
`scripts/release-pr.ts`, and the release-PR flow of issue #1379 is unchanged.

## Out of scope

- Any Bash test migration (row J2, #1343), including
  `scripts/tests/fixtures/release/generate-github-golden.sh`; black-box tests added
  here are added beside them.
- The scripts bundled with skills and extensions and `scripts/create-extension.sh`
  (row H, #1337); `scripts/build-ci.sh` and the CI checks (rows I1, I2); the
  comment in `scripts/check-extension-manifest-version.sh` that names the driver.
- Retiring `scripts/lib/common.sh` and the other shell libraries (row J4).
- Porting `scripts/lib/release-rehearse.mjs` and the gitmoji facade to TypeScript.
- Any change to the engine, the plugins, the release rules, the release note, the
  tag format, the release-PR flow, the forges supported, the archive's contents or
  its single-asset rule.
- Packaging for the Claude Code, GitHub Copilot CLI and Antigravity CLI.
- A latency budget for the six entries.

## Open questions

- Whether the Windows job can run the real engine (it needs the development
  dependencies) or must stub `release-rehearse.mjs` behind a test seam, to be
  measured on `windows-latest`.
- The exact quoting of the prepare command for `cmd.exe` and `sh -c` when the root
  holds a space or a quote, to be pinned by the unit suite and the Windows job.
- Whether `gemini extensions validate` under PowerShell needs the `.cmd` launch
  plan of `scripts/lib/install/spawn.ts`.
- The complete list of suites that read the text of a migrated script, and the
  black-box substitute of each retired in-process group (requirements 22 and 23), to
  be fixed in the PLAN.

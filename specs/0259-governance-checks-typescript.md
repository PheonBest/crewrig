---
id: "0259"
slug: governance-checks-typescript
status: approved
complexity: standard
interaction-mode: MINIMAL
related-issue: 1338
version: 1.0.0
---

# Repository-governance checks in TypeScript

*Sub-spec I1 of the `large`-tier ticket #1231, row I1 of the architect decomposition
(<https://github.com/crewrig/crewrig/issues/1231#issuecomment-5857477069>). Parent
spec: `specs/0215-shell-to-typescript-migration.md` (requirements 12, 13, 14, 16
(Python) and 17, row I1, step (d) of requirement 8), under the release-branch regime
of `specs/0215-shell-to-typescript-migration.delta-04.md` (requirements 27-38): this
spec-PR and its implementation pull requests target `release/1231-ts-migration`,
"shipped" means merged there, not reached `main`, and the base ref wherever a protocol
names `main` is `origin/release/1231-ts-migration` (requirement 34). Requirement 23 of
the parent applies as narrowed by `specs/0215-shell-to-typescript-migration.delta-05.md`.
Depends on row H (`specs/0258-skill-extension-bundled-scripts-typescript.md`) and on
the shared modules of rows A2 (`specs/0240-runtime-foundations-shared-ts-modules.md`),
G1a (`scripts/lib/build-components/*`), G1b (`specs/0254-extension-plugin-builders-typescript.md`:
`scripts/lib/extension/*`) and F2 (`scripts/lib/link-or-copy.ts`). The shape of the
row (dark entries, differential proof, Windows job, then a switch) follows rows F1, G2
and H.*

## Intent

A maintainer, a contributor and a CI runner invoke the repository-governance checks
exactly as today and get the same verdict, the same diagnostics on the same streams and
the same exit status on the same input, whether they run Linux, macOS or Windows
without a POSIX layer. The checks that gate every pull request, among them the
version-bump convention, the test-wiring guard, the machine-path guard and the
Markdown link checker, need no `jq`, `yq`, `awk`, `sed`, `grep`, `find`, `sort` or
Python on the machine. The Python helper of these checks,
`scripts/lib/check-figure-labels.py`, no longer exists.

<!-- markdownlint-disable MD029 -->

## Requirements

### Scope and entry points

1. **Entry points.** Eighteen TypeScript entries SHALL replace the behaviour of
   `scripts/check-{skill-versions,extension-version-bump,extension-provenance,
   extension-manifest-version,extension-hook-map,extension-hook-tokens,extension-pivot,
   component-metadata-keys,core-paths,feedback-routing,gemini-overlay-enrollment,
   claude-agent-layout,agents-size,no-machine-paths,markdown-links,figure-labels,
   test-wiring,test-strays}.sh`, each at the path of its predecessor with `.sh` changed
   to `.ts`. `scripts/lib/check-figure-labels.py` SHALL be replaced by TypeScript and
   deleted (parent requirement 16). The Python files that import `mempalace` and
   `scripts/lib/en_us_sweep.py` (row I2, #1339) are outside this row and SHALL NOT change;
   every other file outside this list SHALL NOT change in behaviour.

2. **Entry form.** Each entry SHALL be runnable as a direct
   `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/<name>.ts` command
   line, SHALL follow the conventions of parent requirement 2 and of the existing
   `scripts/check-path-ownership.ts` (a thin entry, one clearly named helper module per
   concern under `scripts/lib/`, `process.exitCode` instead of `process.exit` after
   output), and SHALL keep every file, entry and module, under 300 lines (spec 0238).

3. **Observable contract.** Each entry SHALL preserve the observable contract of the
   script it replaces (parent requirement 14): arguments, environment variables read
   (`CREWRIG_REPO_DIR`, `BASE_REF`, the working directory where the shell reads it),
   files read and written, exit codes, standard output and standard error, byte for
   byte, with the shell run under `LC_ALL=C`, except for the deviations of
   requirement 24, which is a closed list. The streams each script uses today are part
   of the contract: findings on standard output where the shell prints them there.

4. **No new spawned tool.** No entry SHALL spawn `jq`, `yq`, `awk`, `sed`, `grep`,
   `find`, `sort`, `mktemp`, `wc`, `basename`, `dirname`, `head`, `tr`, `python3` or
   `sh` (parent requirement 23). JSON SHALL be read with the Node.js standard library,
   YAML and front matter with `js-yaml` or the front-matter reader of
   `scripts/lib/build-components/`. The tools an entry MAY spawn are exactly: Git; the
   current Node.js interpreter (`process.execPath`); `tesseract` for `check-figure-labels`
   (a wrapped native tool of the user's choice that ships a Windows build, as the wrapped
   tools of spec 0258 requirement 6); and `bash`, only for `check-test-strays`
   (requirement 20), whose purpose is the syntax check of Bash suites.

5. **Reuse, not duplication.** The entries SHALL reuse the existing TypeScript modules
   instead of re-implementing their logic: `scripts/lib/extension/*` (manifest reader,
   shape guard, `discoverDirs`, the hook vocabulary, emitter and resolver, the
   in-process renderer), `scripts/lib/build-components/*` (front-matter reader,
   output-directory list), `scripts/lib/ts-scope.ts` (repository root, `git`, tracked
   file list), `scripts/lib/paths.ts`, `scripts/lib/line-endings.ts`,
   `scripts/lib/glob-engine.ts` and `scripts/lib/link-or-copy.ts` wherever the shell
   performed the same operation. Logic with no existing twin SHALL be added once, as a
   module of its own: a Git base-ref resolver with the semantics of
   `scripts/lib/base-ref-resolve.sh` (`normalize_base_ref`, `default_base_ref`,
   `resolve_remote_ref`, written so that row I2 reuses it when it retires that shell
   file), a provenance-carrier reader with the semantics of
   `scripts/lib/provenance-carrier.sh` (`first_body_line`, `carrier_field`), a Python
   `difflib.SequenceMatcher` ratio, and a tesseract TSV parser.

6. **Determinism.** Wherever the shell sorts or relies on `find` or glob order under
   `LC_ALL=C`, the entry SHALL order by UTF-16 code unit of the path string, which
   equals byte order for the ASCII paths of this repository, and SHALL print the same
   sequence. Where the shell relies on Git's own order, the entry SHALL keep Git's.

### The version-bump checks

7. **`check-skill-versions` and `check-extension-version-bump`.** They SHALL resolve
   the base ref exactly as the shell does (argument, else `BASE_REF`, else the default
   of the preferred remote; trailing slash normalised; the `git fetch --depth=50`
   fallback; exit 2 with the same two diagnostic lines when it cannot be resolved), SHALL
   compare the working tree against the base blob (uncommitted edits count), SHALL count
   only modified files (status `M`), and SHALL print the same `OK`, `FAIL` and summary
   lines and the same exit status. The text of the unresolvable-base diagnostic SHALL be
   the text the shell actually prints (its backtick command substitution included),
   not the text it was meant to print; correcting that text is a separate change.

8. **Provenance contract.** `check-extension-provenance` SHALL apply the same rules R1,
   R5 and R7 of spec 0043 to every `SKILL.md` and `AGENT.md` regular file below
   `extensions/core` and `extensions/library` of the working directory (symlinked files
   excluded, as `find -type f` does) with the carrier reader of requirement 5, and
   SHALL print the same lines, including the `OK` summary when zero files are checked.

9. **Manifest and pivot.** `check-extension-manifest-version` SHALL read the
   authoritative `package.json` version of each extension of the core and library
   tiers and compare it with the sibling `extension.json`, through the shape guard of
   `scripts/lib/extension/`, with the shell's treatment of a missing or non-string
   version (`jq '.version // empty'`). `check-extension-pivot` SHALL apply the same
   sibling rules to `commands/*.toml` and `agents/*` directories and SHALL print the
   same checked counts.

10. **Hook map and hook tokens.** `check-extension-hook-map` SHALL compare
    `docs/extension-hook-events.md` with the translator in process (the probe manifest
    held in memory, the closed event set, the per-target mapping and the target table
    of `scripts/lib/extension-targets.json`) and print the same disagreement lines.
    `check-extension-hook-tokens` SHALL render every discovered extension for all four
    targets through the in-process renderer and fail on a surviving neutral
    extension-root token in the four emitted hook files, leaving the same output
    files behind as the shell (`build/extensions/**`, `dist-copilot-plugin/**`,
    `dist-antigravity-plugin/**`, with `extensions/*/*/dist-claude-plugin` removed). It
    SHALL execute the repository's real render path so that a defect injected into that
    path is caught (the mutation cases of the Bash suites).

### The metadata, routing and layout checks

11. **`check-component-metadata-keys`, `check-feedback-routing`.** They SHALL read the
    YAML front matter of the component sources with the repository's YAML reader and
    SHALL give the shell's findings for the same documents, including the key order of
    `yq keys` where the shell prints keys (alphabetical) and the shell's treatment of
    missing and empty values.

12. **`check-core-paths`.** It SHALL compare the manifest `.crewrig/core-paths.txt`
    and `docs/layers.md` with the committed tree (`git cat-file -e HEAD:<path>`,
    `git ls-tree`) and with the output-directory list of the component builder
    obtained through its `--list-output-dirs` mode of the repository's own builder
    entry, and SHALL print the same lines and exit statuses (0, 1, 2).

13. **`check-gemini-overlay-enrollment`.** It SHALL obtain the deployed set from the
    setup-declarations printer exactly as the shell does, SHALL fail closed with exit 2
    on every path where the shell does, SHALL print reverse-direction warnings before
    failures, and SHALL parse JSON without Python.

14. **`check-claude-agent-layout` and `check-agents-size`.**
    `check-claude-agent-layout` SHALL inspect the working tree (not Git) for symlinks
    below `.claude/agents` and SHALL print the absolute path in its absent-directory
    line as the shell does. `check-agents-size` SHALL count BYTES, not characters, with
    the same 22000-byte threshold and optional path argument. It has no Bash test, so a
    black-box test SHALL gain it before or with its entry (parent requirement 13); that
    test SHALL cover the pass, the fail and the boundary at the threshold, and SHALL
    play the oracle role.

### The repository scans

15. **`check-no-machine-paths`.** It SHALL report the same occurrences of
    `/(Users|home)/<owner>` in the same order, with the same benign-owner rules (`agent`
    always; `ana` only in the drive-letter `/Users/` form at a word boundary), the same
    binary-file behaviour as `git grep`, and the same self-exclusion, which SHALL name
    the new files (the entry and its tests) so that they do not flag themselves.

16. **`check-markdown-links`.** It SHALL apply the link-extraction and resolution rules
    of the Python implementation it replaces (the link pattern, fenced code blocks
    toggled by a line whose stripped text starts with three backticks, inline code
    removed, scheme and fragment and template-variable skips, the issue/pull-link skip,
    percent-decoding, resolution relative to the file's directory, existence of a file or
    directory), from the current working directory's Git top level, with the same
    messages, all on standard output. Resolved paths SHALL be printed with forward
    slashes (requirement 24 (b)). Line numbers SHALL be those of Python's universal
    newlines.

17. **`check-figure-labels`.** It SHALL keep the `[SKIP]` note and exit 0 when
    `tesseract` is absent, found by spawning it (no `command -v`), SHALL delete the
    Python dependency, and SHALL port the label extraction, the word clustering, the
    normalisation and the `SequenceMatcher` ratio (threshold 0.75, the 50 % word rule
    and the order rule) with the shell's output lines. Because the existing Bash test
    passes by skipping where `tesseract` is missing, a hermetic black-box test with a
    stand-in `tesseract` on the search path SHALL gain it before or with the entry.

18. **`check-test-wiring`.** It SHALL keep the first-occurrence rule (the text before
    the first occurrence of `scripts/tests/<name>` on a line, the `#` test, the
    following-character test), the exemption-file grammar and the three failure blocks.
    It continues to inspect `test-*.sh` suites only: widening it to `*.test.ts` belongs
    to row J2.

19. **`check-test-strays` options.** It SHALL accept and ignore `--base-ref`,
    `--cache-dir` and `--jobs` (each needing a value) and exit 2 with the shell's message
    on any other argument or a missing value.

20. **`check-test-strays` syntax check.** It SHALL run `bash -n` on every
    `scripts/tests/test-*.sh` in order and stop at the first failure with the shell's
    block. Because a POSIX shell is not a prerequisite on Windows (parent requirement 5)
    and Bash suites run only on POSIX runners, on `win32` it SHALL print one `SKIP:`
    line naming the reason on standard output and exit 0 without spawning (deviation
    (c)); a missing `bash` on a POSIX host SHALL exit 2 with an `Error:` line.

### Switch, retirement and wiring

21. **Forwarding shims.** In the switch pull request each of the eighteen `.sh` files
    SHALL become a forwarding shim of the shape of `scripts/build-extension.sh` (the
    Node.js floor guard, then the TypeScript entry with every argument and its standard
    input, status passed through, fail closed when `node` is absent). The shims remain
    in `ci/shell-allowlist.txt` (they are shell files until row J4) and the Bash suites
    `scripts/tests/test-check-*.sh` SHALL run through them unchanged in their
    assertions (parent requirement 13). `scripts/lib/check-figure-labels.py` SHALL be
    deleted and removed from the allowlist and the ratchet.

22. **Retirement of the two shell libraries.** `scripts/lib/provenance-carrier.sh` and
    `scripts/lib/extension-manifest.sh` SHALL be deleted only in a pull request after
    which no shell consumer of either remains. Their consumers are: the two
    version-bump and provenance checks and `check-extension-hook-tokens` and
    `check-extension-manifest-version` (all TypeScript after the switch);
    `scripts/tests/test-extension-mcp-manifest.sh`, which sources
    `extension-manifest.sh` in process and is therefore retired in the same pull request
    as the library under the sourced-library exception of parent requirement 13, with
    the list of the behaviours it asserts each mapped to an unchanged black-box test of
    a consumer script or to a test of `scripts/lib/extension/` recorded in the plan;
    and `scripts/tests/lib/shell-extension-harness.ts`, whose shell leg for
    `extension-manifest.sh` SHALL be replaced by golden expectations generated from
    the shell before the library is deleted. `scripts/lib/extension-hooks.sh` is
    NOT retired by this row (the probe script and the harness still use it).

23. **Callers and static reads.** Every caller of a migrated script SHALL be retargeted
    to the TypeScript entry command line of requirement 2, or left on the shim where a
    still-shell caller needs it: the capabilities in `ci/ci-capabilities.yml` with the
    generated `.github/workflows/build.yml` and `.gitlab-ci.yml` regenerated from a fresh
    base, the `Taskfile.yml` entries, the skills and docs that name the scripts (bumping
    the version of any skill source touched, per the version-bump convention), the wiring
    and allowlist fixtures (`scripts/tests/extension-ci-wiring.test.ts`,
    `scripts/tests/build-components-ci-wiring.test.ts`, the
    `old-invocation-allowlist.txt` fixtures, `scripts/tests/lib/setup-declarations-consumers.ts`)
    and the runtime requirements of each capability: `jq`, `yq`, `python@3.12` and the
    `yq` install steps SHALL be removed from the jobs that no longer need them. Every
    Bash suite that greps or mutates the TEXT of a migrated script (the hook-map, hook-tokens
    and claude-agent-layout suites, and any further suite the plan lists) SHALL be
    retargeted, assertions unchanged, in a pull request before the switch so that its
    mutation reaches the TypeScript twin as well.

24. **Deviations (closed list).** (a) Ordering follows requirement 6. (b) On Windows,
    paths printed by `check-markdown-links` and `check-figure-labels` use forward slashes.
    (c) `check-test-strays` on `win32` follows requirement 20. (d) Where the shell fails
    through its own runtime and not through a message of the script (an unreadable or
    missing input file whose `set -e` failure prints a Bash diagnostic that carries the
    script path and a line number, as `check-agents-size` does for a missing path), the
    entry SHALL print one `Error: <path>: <reason>` line on standard error and exit 1
    (the status of the shell's `set -e` abort); such inputs are excluded from the byte comparison of
    requirement 26, which still compares their exit status. No other deviation is
    permitted.

25. **The `yq` and `jq` pin of the GitLab generator.** This row SHALL NOT change
    `tool_install_lines` of `scripts/build-ci.sh`: the generator is shared by every
    GitLab job, belongs to row I2 (#1339), and the migrated checks need neither tool,
    so this row only deletes the `yq` and `jq` installs that its own jobs no longer
    use. Pinning `yq` (version and checksum) and `jq` in `tool_install_lines`, so that
    the `skill-scripts-ts` oracle of row H runs against the versions its goldens were
    made with, is explicitly left to I2 and SHALL be recorded on #1339.

### Proof

26. **Differential proof before the switch.** Before any switch, a test SHALL run each
    shell script under `LC_ALL=C` and its TypeScript entry on the same input and require
    equal standard output, standard error and exit status: on the real repository, and
    on every fixture of the script's Bash suite. The fixture comparison SHALL be made by
    running the UNCHANGED Bash suite inside a sandbox in which the script is replaced by
    a wrapper that runs both implementations, fails on any difference and returns the
    shell's result. The sandbox SHALL copy only what Git tracks, SHALL provide `.git`,
    the root `package.json` and real copies of `js-yaml` and `argparse`, SHALL delete `CI`
    and `NODE_TEST_CONTEXT` from the child environment, and the comparison SHALL run in an
    Ubuntu 24.04 container before each pull request opens.

27. **`windows-latest` job.** Every migrated check SHALL ship, in the pull request that
    adds its entry, a case of a `windows-latest` job that runs the entry from PowerShell
    against the real repository and against a fixture that makes it fail, and asserts
    verdict, diagnostic and exit status, with the interpreters resolved from the parent
    `PATH`, the Windows git settings of `GIT_CONFIG_NOSYSTEM=1`, and each test file under
    300 lines. The job SHALL pass before the pull request merges (parent requirement 17).

28. **Ratchet and quality gates.** Every tracked file counts for the ratchet, fixtures
    included (stored with a `.golden` suffix and no leading `#!`). All new TypeScript
    SHALL pass the repository's type-check, erasable-syntax, Oxlint and Oxfmt steps and the
    300-line limit.

29. **Oracle suites.** The Bash suites `scripts/tests/test-check-*.sh` of the scope SHALL
    NOT migrate in this row (row J2, #1343) and SHALL pass, unchanged in their
    assertions, against the TypeScript entries on Linux CI after the switch.

30. **Pull-request grouping.** The implementation SHALL ship as a bounded number of pull
    requests, each reviewable on its own and each carrying the entries, the differential
    proof and the Windows cases of its checks; the plan SHALL fix the grouping. Every
    pull request but the last SHALL use a branch named `test/1338-<slug>`; the last
    flips the status of this spec and its deltas to `implemented`.

## Scenarios

**Scenario:** Same verdict on the repository

Given the repository at the release tip
When  each of the eighteen checks runs as the shell script under `LC_ALL=C` and as its
      TypeScript entry
Then  standard output, standard error and exit status are equal for every check.

**Scenario:** A failing fixture fails the same way

Given a fixture of a Bash suite that makes `check-extension-provenance` fail
When  the unchanged suite runs with the comparison wrapper in place of the script
Then  both implementations print the same `FAIL` line and summary and exit 1.

**Scenario:** A Windows contributor

Given a `windows-latest` runner with Node.js 24 and no POSIX layer on the `PATH`
When  PowerShell runs `node scripts/check-markdown-links.ts` on a repository with a broken link
Then  it prints the `FAIL` line with forward slashes and exits 1.

**Scenario:** Missing `tesseract`

Given a machine without `tesseract`
When  `check-figure-labels` runs
Then  it prints the `[SKIP]` note and exits 0.

**Scenario:** Retirement blocked by a consumer

Given a shell file that still sources `scripts/lib/extension-manifest.sh`
When  the retirement pull request is prepared
Then  the library is not deleted until that consumer is retired or replaced.

## Out of scope

- `scripts/build-ci.sh` and the I2 tools (`check-model-mappings`, `check-agent-profiles`,
  `check-ci-parity`, `check-spec-id-reserved`, `reserve-spec-id`, `merge-spec-pr`,
  `sweep-en-us`), including the `yq`/`jq` pin of `tool_install_lines` (requirement 25).
- The migration of any Bash test under `scripts/tests/` (row J2, #1343), and
  widening `check-test-wiring` to `*.test.ts` suites.
- `scripts/lib/base-ref-resolve.sh` and `scripts/lib/extension-hooks.sh` (retired by
  their last consumers), `check-bash32-portability.sh` and `check-pipefail-grep.sh`
  (row J4).
- The `mempalace` Python files and `package-lock.json` (#1614).
- The tickets #1614, #1599, #1509, #1545, #1601, #1341 and the final shim removal of
  #1344.

## Open questions

- None. The decisions that the ticket left open are recorded above: the
  `yq`/`jq` pin is left to I2 (requirement 25); `check-test-strays` skips on `win32`
  (requirement 20); the shell files remain as forwarding shims until row J4
  (requirement 21).

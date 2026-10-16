---
id: "0260"
slug: hook-ops-tests-typescript
status: draft
complexity: standard
interaction-mode: MINIMAL
related-issue: 1340
version: 1.0.0
---

# Bash tests of hooks, usage and operational commands in TypeScript

*Sub-spec J1a of the `large`-tier ticket #1231, row J1a of the architect decomposition
(<https://github.com/crewrig/crewrig/issues/1231#issuecomment-5857477069>). Parent
spec: `specs/0215-shell-to-typescript-migration.md` (requirement 13, row J, step (e) of
requirement 8), under the release-branch regime of
`specs/0215-shell-to-typescript-migration.delta-04.md` (requirements 27-38): this
spec-PR and its implementation pull requests target `release/1231-ts-migration`,
"shipped" means merged there, not reached `main`, and the base ref wherever a protocol
names `main` is `origin/release/1231-ts-migration` (requirement 34). Depends on the
sub-specs whose scripts these suites exercise and which shipped green: C1
(`specs/0243-usage-capture-hooks-typescript.md` and its deltas), C2
(`specs/0248-worktree-git-guard-typescript.md`), C3
(`specs/0247-mempalace-transcript-hook-typescript.md` and its deltas) and F3
(`specs/0253-history-import-operational-commands-typescript.md` and its deltas), and on
row H (`specs/0258-skill-extension-bundled-scripts-typescript.md`), the most recent row
of the release branch. Siblings of the same wave: J1b (#1341), J2 (#1343), J3 (#1342)
and the final removal J4 (#1344).*

## Intent

A maintainer who changes a usage command, the worktree claim, the upstream sync, the
MemPalace transcript hook or the usage-capture hook gets the same regression coverage
as before, from tests that run with `node --test` on Linux, macOS and Windows, with no
Bash test file left for these commands. A reviewer can see, suite by suite, which
behaviour each old Bash assertion checked, which new test checks it now, and
evidence that a broken implementation which turned the old suite red turns the new
suite red too.

<!-- markdownlint-disable MD029 -->

## Requirements

### Scope and boundary

1. **The twelve suites.** The Bash suites below SHALL be replaced by TypeScript
   `node --test` suites and then deleted (parent requirement 13). The scripts under
   test shipped green in rows C1, C2, C3 and F3, and are today thin `.sh` shims over
   TypeScript entries:

   | Bash suite | Lines | Under test | Shipped by |
   |---|---:|---|---|
   | `test-usage-attribution.sh` | 1359 | `usage-attribute`, `usage-query`, `usage-prune`, `scripts/lib/usage-*` | C1, F3 |
   | `test-usage-capture.sh` | 822 | `hooks/usage-capture`, `usage-backfill`, `scripts/lib/usage-capture/*` | C1, F3 |
   | `test-usage-dashboard.sh` | 2922 | `usage-dashboard`, `scripts/lib/usage-dashboard/*` | F3 |
   | `test-usage-pricing.sh` | 2568 | `usage-price`, `usage-prune`, `usage-attribute`, `scripts/lib/usage-price/*` | F3 |
   | `test-usage-record-schema.sh` | 145 | `scripts/lib/usage-record-validator.js`, `schemas/usage-record/` | C1 |
   | `test-usage-storage-mirror.sh` | 1844 | `usage-mirror`, `usage-prune`, `scripts/lib/usage-store/*` | F3 |
   | `test-usage-storage.sh` | 1726 | `usage-query`, `usage-prune`, `scripts/lib/usage-store/*` | F3 |
   | `test-worktree-claim.sh` | 1599 | `scripts/worktree-claim` | C2 |
   | `test-worktree-git-guard.sh` | 101 | `hooks/worktree-git-guard` | C2 |
   | `test-mempalace-transcript-hook.sh` | 379 | `hooks/mempalace-transcript` | C3 |
   | `test-palace-path-propagation.sh` | 179 | `scripts/lib/common.sh` (sourced library) | C3, D |
   | `test-sync-from-upstream.sh` | 3273 | `scripts/sync-from-upstream` | F3 |

2. **Boundary with the sibling rows.** The following suites are NOT in this row, and
   this row SHALL NOT edit them. The reason for each choice is recorded here because the
   architect decomposition leaves the exact list to this spec:

   | Suite | Row | Reason |
   |---|---|---|
   | `test-setup-claude-transcript.sh`, `test-setup-gemini-transcript.sh`, `test-setup-copilot-transcript.sh`, `test-setup-antigravity-transcript.sh`, `test-setup-usage-capture-optin.sh`, `test-setup-gemini-settings-merge.sh` | J1b (#1341) | They exercise the `setup-*-interactive` entry points (row F1) and the setup-time hook rewrite; the decomposition assigns `test-setup-*` to J1b, although specs 0243, 0247 and 0248 name them in their own scope. |
   | `test-tls-delegation.sh`, `test-system-context-store.sh` | J1b (#1341) | They test `scripts/lib/tls-delegation.sh`, `tls-exec.sh` and the `install_dir` function of `common.sh` through the setup path. |
   | `test-mempalace-runtime-guard.sh`, `test-mempalace-pin.sh`, `test-mempalace-version-range.sh`, `test-mempalace-doctor.sh`, `test-mcp-daemon.sh`, `test-chroma-*.sh`, `test-repair-mempalace-http.sh`, `test-rotate-mempalace-token.sh` | J1b (#1341) | Row D scripts and their libraries. |
   | `test-build-docs-index.sh`, `test-build-ci.sh` | J2 (#1343) | Build scripts of rows G1-G2; spec 0253 names `build-docs-index` only to say that `sync-from-upstream` does not call it. |
   | `test-reserve-spec-id.sh`, `test-check-spec-id-reserved.sh`, `test-check-ci-parity.sh`, `test-check-*.sh` | I1 (#1338), I2 (#1339), J2 (#1343) | Scripts of the CI-checks and spec-workflow rows. |
   | `test-e2e-*.sh`, `test-antigravity-discovery-probe.sh` | J3 (#1342) | The end-to-end harness and the probes. |

3. **A shared library of a sibling row.** `scripts/lib/usage-headless.sh` is a sourced
   Bash library retired by J3. The one group of `test-usage-capture.sh` that sources it
   (group G15) SHALL be ported by this row to a TypeScript test that spawns `bash` to
   source the library, in its own file, and J3 SHALL delete that file in the same pull
   request that retires the library. Parent requirement 13's sourced-library exception
   names `common.sh`-style libraries whose consumers have a black-box test; the consumers
   of `usage-headless.sh` have none that this row leaves unchanged, so a retirement
   without a port is not available for it.

### What a migrated suite preserves

4. **Replacement per suite.** Every suite of requirement 1 SHALL have the replacement
   suite and the assertion mapping given in *Suite sections* below. Each replacement
   file SHALL stay under 300 lines, a shared helper lives under `scripts/tests/lib/`
   and every new file is TypeScript (parent requirements 1-3 and 11).
5. **No assertion is lost.** Every case and group of a Bash suite SHALL appear in the
   mapping of its suite exactly once, with the replacement test that checks it and the
   strings or values that the replacement SHALL keep verbatim (a diagnostic line, an
   exit status, a counter, a hash). A replacement MAY assert more than the Bash suite
   did, and SHALL NOT assert less, except for the entries listed under *Changed or
   dropped assertions* of its suite section, each with its justification.
6. **Shell-only properties.** An assertion that checks a property only a shell file has
   (the Bash `EXIT` trap that restores a mutated tracked file, a `bash -n` syntax
   check, a dirty-tree guard that exists because the suite rewrites tracked files in
   place) SHALL be removed with its Bash suite and listed under *Changed or dropped
   assertions* (parent requirement 13).
7. **Mutations on a copy.** A mutation case SHALL mutate a temporary copy of the
   implementation files, never a tracked file in place, and SHALL fail, not skip, when
   the text it needs to mutate is absent. A mutated copy SHALL contain only the files
   that git tracks.
8. **Non-vacuity.** A replacement that iterates over fixtures SHALL assert a floor on
   the number of fixtures it found. A prerequisite that the CI runner image provides
   (`node:sqlite`, `ssh-keygen` with `-Y sign`, a Git that supports SHA-256) SHALL make
   the test fail when the environment variable `CI` is set and skip with a stated reason
   otherwise; a test that is skipped in CI proves nothing.
9. **Hermeticity.** A replacement SHALL run with a scratch `HOME` and `USERPROFILE`, SHALL
   delete `CI` and any proxy variable that it does not mean to test from the environment
   of a child process that runs a partial copy of the repository, SHALL use a free local
   port for any server, and SHALL write nothing under the real home directory. A Bash
   suite that wrote under the real home directory (the token directory of
   `test-usage-storage*.sh`, the TLS wrapper of `test-palace-path-propagation.sh`) does
   not carry that behaviour over.
10. **Entry under test.** A replacement SHALL run the same entry the Bash suite ran, the
    `.sh` shim where the Bash suite exercised the shim, and the TypeScript entry directly
    through `process.execPath` where the Bash suite only needed the behaviour. The shim
    SHALL stay covered by at least one test per script that this row's suites reach
    through it.

### The sourced-library suite

11. **`test-palace-path-propagation.sh` retires, it does not port.** The suite sources
    `scripts/lib/common.sh` and calls `install_mcp_launcher`, `_materialise_chroma_unit`
    and `mcp_token_path` in-process, which cannot run against a TypeScript module. Under
    the sourced-library exception of parent requirement 13 it SHALL be retired in the pull
    request that first covers every behaviour it asserts by a black-box test of a
    consumer, and the mapping under *Suite sections* names, per assertion, the substitute
    consumer-level test. The assertions on the palace path recorded in the materialised
    TypeScript launcher have no consumer-level test today; a new suite
    `scripts/tests/service-launcher-palace-path.test.ts` SHALL cover them, and SHALL land
    before or with the deletion.

### Proof that coverage did not regress

12. **Mutation proof.** For each suite, the *Mutation set* of its section lists the mutants
    of the implementation that the proof applies. The pull request that replaces a suite
    SHALL show, in its body, a table with one row per mutant: the Bash suite run at the
    base commit turns red, the replacement turns red, and the unmutated baseline is green
    for both. A mutant that the Bash suite caught and the replacement does not catch
    blocks the pull request. Mutants already built into a suite (the in-suite mutation
    cases of the usage suites) are part of the replacement and are listed there.
13. **Two environments.** A replacement that spawns Git, `ssh-keygen`, a local server or a
    signed commit SHALL be run in an Ubuntu 24.04 container that mirrors the CI runner
    (Bash 5.2, `jq` 1.7, Node 24, GNU `tar` and `gzip` on the hermetic path) before the
    pull request opens, in addition to the developer's machine, and a golden value that
    contains a host-specific string (a Node path, a timestamp, a random token, a port)
    SHALL be normalised before it is compared.
14. **Mapping audit.** Each pull request SHALL carry, in its body, the count of Bash cases
    removed and the count of replacement tests that cover them, and the reviewer seat
    SHALL be able to reconcile the two from the mapping of this spec.

### Wiring and deletion

15. **Deletion and allowlist.** The pull request that replaces a suite SHALL delete the
    Bash file, remove its line from `ci/shell-allowlist.txt` and keep `check-test-wiring`
    and `check-test-strays` green (parent requirements 10 and 12).
16. **CI wiring.** Each CI job that ran a deleted suite SHALL run its replacement through
    `node --test`, inside the stray-scan wrapper wherever the Bash invocation had it,
    in the same file and under the same job id, and the path filters of the job SHALL name
    the replacement files. The new suites SHALL join the existing TypeScript jobs, on
    Linux and on `windows-latest` (parent requirement 17), and the generated files SHALL be
    regenerated from `ci/ci-capabilities.yml` rather than edited.
17. **Windows.** The files of a suite that need no POSIX tool SHALL run on `windows-latest`
    with the existing Windows jobs of their script; a file that needs `bash`, a POSIX
    permission bit or a symbolic link SHALL skip on `win32` with a stated reason, and the
    Windows job SHALL name that skip so that it is visible. A Windows job SHALL NOT pick
    `System32\bash.exe`.
18. **Static reads.** Every file that names a deleted suite (a source comment, a document,
    a workflow, an allowlist) SHALL be retargeted in the pull request that deletes the
    suite, except the files of another row, which this row reports to the coordinator
    (see *Open questions*).

### Delivery

19. **Pull requests.** The implementation SHALL ship as five pull requests into the
    release branch, in the grouping of the *Decision record*. Every implementation branch
    but the last SHALL be named `test/1340-<slug>`, and the last SHALL flip this spec and
    its deltas to `status: implemented`. Each pull request SHALL be rebased on the release
    tip, SHALL have green CI including `ratchet`, `lint-typescript` and the Windows jobs,
    and SHALL get an `APPROVE` verdict from a cold reviewer seat before a merge is asked.
20. **Behaviour of the scripts is frozen.** No pull request of this row SHALL change the
    behaviour of a script under test. A defect found while porting a suite SHALL be
    reported to the coordinator and the replacement SHALL assert the current behaviour
    with a comment naming the report.

### Suite sections

For each suite: the replacement files, the mapping from each Bash case or group to the
replacement test, the assertions changed or dropped, the mutation set, the platform and
the wiring. Case labels are those of the Bash suite, so that `git log -p` of the suite
at the base commit remains the reference.

#### Hooks, capture and the retired library test (pull request A)

##### `scripts/tests/test-usage-capture.sh` (822 lines)

- **Replacement suite.** Group labels `G1`..`G16` below are the inventory's numbering of the Bash suite's 16 test groups, in file order (G1 = L271-410 per-fixture derivation, G2 = L192-269 headless checks, G3 = events-jsonl-ignored, G4 = §2 R28, G5 = §5 R24, G6 = §6, G7 = §7(a), G8 = §7(a'), G9 = §7(b)(i)/(ii), G10 = §7(b)(ii) i1-F2, G11 = §7(b)(iii), G12 = §7(c), G13 = §8 i1-F1, G14 = §9 R18, G15 = §10 R18, G16 = §11 R20).

| replacement file | what it holds | est. lines |
|---|---|---|
| `scripts/tests/lib/usage-capture-fixtures.ts` (shared, new) | fixture discovery (every `expected.json` carrying an `adapter` key), `derive()` wrapper around the existing `scripts/tests/lib/usage-capture-derive.js` (spawned per call, keeps `CREWRIG_USAGE_ROOT` isolation; helper is kept, not ported), temp copy of fixture `home`, copilot sqlite materialisation | ~90 |
| `scripts/tests/usage-capture-derivation.test.ts` | G1, G3, G4, G13 | ~200 |
| `scripts/tests/usage-capture-headless.test.ts` | G2, G14, G16, G6 (`assertRecordShape` rejection loop; split to `usage-capture-shape.test.ts` ~60 lines if the file nears 300) | ~230 |
| `scripts/tests/usage-capture-shim.test.ts` | G7, G8, G9, G10, G11, G12 via `bash hooks/usage-capture.sh` (shim only; entry `.ts` stays in `usage-capture-hook.test.ts`) | ~230 |
| `scripts/tests/usage-capture-backfill.test.ts` | G5 | ~110 |
| `scripts/tests/usage-headless-agy.test.ts` | G15, bash-spawning port of a sourced library. Row J3 retires `scripts/lib/usage-headless.sh`; J3 MUST delete this test in the same diff (it exists only to pin the library until then) | ~140 |

- **Assertion mapping.**

| label | behaviour asserted | replacement::test intent | MUST survive |
|---|---|---|---|
| G1 | per fixture: captured/uncaptured counts == `expected.json` (R27); every `rec-*.json` valid against v1 schema (ajv); second `--submit` stores 0 (R23, incl. sink recordId dedup for gemini `legacy-json` / `json-kind-summary`); zero discovered fixtures = FAIL | derivation::one generated test per fixture, plus a non-vacuity test (count equals a directory scan and is > 0; today 15 adapter fixtures) | 15 fixtures incl. antigravity, claude-code (2), copilot-cli (2), gemini-cli (5), headless (4), unknown |
| G2 | each headless-envelope fixture: `forbiddenText` declared, canaries present in envelope, absent from derived record (R18), `modelId`, `identity.sessionId`, tokens == `expectedTokens`, `raw` keys == `expectedRawKeys`, `raw.stats` keys | headless::table-driven per fixture, one test per fixture | `forbiddenText` non-vacuity guard; canary-absence in record |
| G3 | `copilot-cli/events-jsonl-ignored`: cliVersion from `events.jsonl` session.start, `poisonValue` never in tokens, tokens == sqlite columns | derivation::copilot events ignored | copy fixture `home` to temp before use; set HOME and USERPROFILE to the copy |
| G4 | `unknown/unrecognized-shape`: 0 captured, 1 uncaptured (R28) | derivation::unknown shape | 0 / 1 |
| G5 | static guard: `backfill.js` and `usage-backfill.sh` contain none of `mempalace\|import-(claude\|gemini\|copilot\|antigravity)-history` (case-insensitive); smoke `node backfill.js` under empty HOME exits 0 with lines `^claude-code: 0 stored`, `^gemini-cli: 0 stored`, `^copilot-cli: 0 stored` | backfill::two tests (text guard, smoke) | the three `0 stored` line prefixes (asserted only here; `usage-wrappers-oracle.test.ts` asserts "zero sources", different wording) |
| G6 | `assertRecordShape` rejects every `fixtures/usage-records/mutants/*.json` and `derivation/recordid-mismatch.json` | headless::shape rejection loop (one test per mutant file, fix the count from a directory scan) | `recordid-mismatch.json` included; asserted only here (`test-usage-record-schema.sh` does not call `assertRecordShape`) |
| G7 | shim by absolute path from a foreign cwd, payload naming a nonexistent transcript: exactly one journal entry (excluding `.wing.json`, `.attr.json`) | shim::absolute path, foreign cwd | entry count 1, exclusions |
| G8 | leftover `<root>/spool/<recordId>.json` (0206 hand-over, `schemas/usage-record/samples/gemini-cli.json`) drained into the journal on next capture; spool emptied | shim::spool drain | spool dir empty afterwards |
| G9 | stamp `<root>/state/claude-code/<sha256(path)>.stamp`, source not newer: `compact-snake-case`, `spaced-snake-case`, `camel-case` payloads (`__TRANSCRIPT_PATH__` substituted) take the fast path (marker stub never runs); `no-path-key`, `unresolvable-path` still reach capture | shim::3 fast-path payloads + 2 capture-reached payloads | key = sha256 hex of the exact raw path string via `node:crypto` (no trailing newline) |
| G10 | `relative-path.json` with cwd-local `relative/p.jsonl`, stamp keyed on the literal `relative/p.jsonl`: capture reached (absolute-path conjunct, i1-F2) | shim::relative path not fast | literal-key stamp |
| G11 | source newer than stamp: capture reached | shim::stale stamp (set mtimes with `fs.utimesSync`, no `sleep 1.1`) | strictly-newer ordering |
| G12 | R15 exit-0 contract: node missing from PATH, nonexistent CLI override, throwing stub: each exit 0 and zero bytes on stdout+stderr | shim::three silent exit-0 legs | zero bytes; PATH bin dir built without node (not `/usr/bin`); do not echo child stderr (the phrase "command not found" trips the stray scan) |
| G13 | gemini-cli three generations (`legacy-json`, `json-kind-summary`, `jsonl-set-journal`) yield pairwise-distinct `provenance.formatFingerprint` (i1-F1) | derivation::fingerprints distinct, fresh root | pairwise distinct |
| G14 | mutation proof R18: copy `lib/usage-capture` + `lib/usage-store` to temp, replace `raw: pickRaw(cli, envelope),` with `raw: envelope \|\| {},` in `adapters/headless-envelope.js`, derive antigravity via absolute `USAGE_CAPTURE_MODULE_ROOT`: canary MUST appear | headless::negative check bites | "replacement changed nothing" guard stays a hard failure |
| G15 | sourced `usage_headless_agy_rewrite_json_response <out> <instant>`: out file == `.response` byte for byte; exactly one record stored, canary absent from usage root; no TMPDIR file ever held the reply; TMPDIR empty afterwards; non-JSON and non-string `response` files left byte-identical (6) | usage-headless-agy::6 tests via `bash -c '. scripts/lib/usage-headless.sh; fn "$1" "$2"'`; mktemp/node PATH shims kept (BSD vs GNU template, TMPDIR scan after each node step) | 6 assertions unchanged; J3 deletes file and library together |
| G16 | headless copilot envelope with `pricing{amountUsd:0.25}`, `total_nano_aiu`, `request_multiplier`: raw keeps them; `firstPartyCopilot(rec,{}).source == "raw.pricing"` | headless::copilot pricing | `0.25`, `raw.pricing` |

- **Changed or dropped assertions.** G11 `sleep 1.1` replaced by `utimesSync` (deterministic, same property). Bash preflights (node:sqlite, `node_modules/ajv`) become hard assertions in `before` hooks (Node 24 floor), never skips. Nothing dropped.
- **Mutation set.** (1) `scripts/lib/usage-capture/adapters/headless-envelope.js`: `raw: pickRaw(cli, envelope),` to `raw: envelope || {},` -> G2 canary and G14 (existing in-suite mutant). (2) `scripts/lib/usage-capture/backfill.js`: add a `// mempalace` comment -> G5 text guard. (3) `hooks/usage-capture.sh`: drop the `cd`-independence (resolve the .ts by relative path) -> G7. (4) `hooks/usage-capture.ts` stamp key: hash `path.resolve(p)` instead of the raw string, or drop the absolute-path conjunct -> G9/G10. (5) `scripts/lib/usage-capture/sink.js`: skip the recordId dedup -> G1 second-pass leg. (6) `scripts/lib/usage-record-validator.js` / `record.js` `assertRecordShape`: accept a mutant -> G6. (7) `scripts/lib/usage-price/copilot.js`: change `source` literal -> G16. (8) shim: `exit 1` on missing node -> G12. (9) `scripts/lib/usage-headless.sh`: leave a reply in TMPDIR -> G15 (J3-scoped).
- **Platform.** `usage-capture-derivation`, `usage-capture-headless`, `usage-capture-backfill`: all platforms (need node:sqlite; temp HOME and USERPROFILE). `usage-capture-shim` and `usage-headless-agy`: POSIX-only (`skip` on win32: Bash shim and Bash library; the entry equivalents already run in `usage-capture-windows.test.ts`).
- **Static reads and wiring.** `.github/workflows/usage-capture.yml` L16, L71 (path triggers), L138 (`ci-cache-guard --stray-scan -- bash scripts/tests/test-usage-capture.sh`: replace by the TS files); `.gitlab-ci.yml` L2820, L2835, L2889; `ci/ci-capabilities.yml` L3620, L3675, L3724; `ci/shell-allowlist.txt` L218; comments naming the suite in `scripts/lib/usage-capture/record.js` L283, `scripts/lib/usage-capture/sink.js` L20, `scripts/tests/lib/usage-capture-derive.js` L3. `usage-capture-derive.js` and `materialize-copilot-db.js` stay.

##### `scripts/tests/test-mempalace-transcript-hook.sh` (379 lines)

- **Replacement suite.** Ported, not retired. Reuses `scripts/tests/lib/transcript-runtime.ts` (`startStub`) and the env builder used by `mempalace-transcript-entry-form.test.ts` (it overrides HOME and USERPROFILE); no new helper. Drop vestigial `TOKEN_PATH_MOCK`, the curl wrapper and `MEMPALACE_PATH` (ignored by the TS hook).

| replacement file | what it holds | est. lines |
|---|---|---|
| `scripts/tests/mempalace-transcript-hook.test.ts` | the 8 groups, black-box through `bash hooks/mempalace-transcript.sh` against `scripts/tests/fixtures/mempalace-transcript/stub-daemon.ts`; shim-to-daemon end-to-end leg | ~170 |

- **Assertion mapping.**

| label | behaviour asserted | replacement::test intent | MUST survive |
|---|---|---|---|
| issue-91 | PostToolUse payload: stub log stays empty although a token is present | hook::PostToolUse skipped | empty request log |
| issue-510-r1 | `MEMPALACE_TRANSCRIPT_QUIET=1` suppresses the success log | hook::quiet suppresses | `mempalace-transcript: persisted` absent |
| issue-510-r2 | QUIET unset logs success | hook::default logs | `mempalace-transcript: persisted` present |
| issue-510-r3 | closed port + QUIET=1: failure log still on stderr | hook::failure not silenced | `FAILED to persist` |
| spec-0161-r1/r2 | `UserPromptSubmit` "Run the test suite" persists content `[USER] Run the test suite` | hook::human prompt prefix | `[USER] Run the test suite` |
| spec-0161-r1/r3 | `<task-notification>` and `<system-reminder>` prompts persist as `[HARNESS] ...` (2 checks, 1 record) | hook::harness prefixes (two tests) | `[HARNESS] <task-notification>`, `[HARNESS] <system-reminder>` |
| spec-0167-r1 | `MEMPALACE_DAEMON_TOKEN_FILE` yields `Authorization: Bearer custom-secret-token` at the stub | hook::token file bearer | `Bearer custom-secret-token` |
| issue-1247 | token never on argv of curl/git, guarded by the daemon having received it | hook::token absent from every recorded URL and non-Authorization header (argv spying stays in `mempalace-transcript-daemon.test.ts` L307-335) | daemon received the token (non-vacuity) |
| spec-0167-r3 | no token anywhere (empty HOME): stderr `DAEMON_UNREACHABLE: token file not found`, exit 0 | hook::missing token | the stderr text, exit 0 |

- **Changed or dropped assertions.** issue-1247: the Bash argv recorder (curl/git wrappers) is replaced because the TS hook spawns no curl; the argv property is already asserted by `mempalace-transcript-daemon.test.ts` and the port keeps the request-side check (a weaker, different property; flagged so the reviewer can reject the swap). Bash EXIT trap and pid kill become `after` hooks of `startStub`.
- **Mutation set.** `hooks/mempalace-transcript.sh`: forward to a wrong entry -> all. `scripts/lib/mempalace-transcript/*` classify: drop the `[HARNESS]` prefix -> spec-0161-r1/r3; emit `[USER]` for harness text -> r1/r3; log the success line even when quiet -> issue-510-r1; swallow the failure log -> r3; send a request on PostToolUse -> issue-91; ignore `MEMPALACE_DAEMON_TOKEN_FILE` -> spec-0167-r1; put the token in a URL -> issue-1247; exit 1 without a token -> spec-0167-r3. VERIFY: exact module names under `scripts/lib/mempalace-transcript/` before the proof.
- **Platform.** Shim legs POSIX-only (`skip` on win32); `mempalace-transcript-windows.test.ts` already runs the `.ts` entry on every platform. Child env sets `NO_PROXY=127.0.0.1,localhost`.
- **Static reads and wiring.** `ci/shell-allowlist.txt` L186; `ci/ci-capabilities.yml` L2167 (stray-scan line); `.gitlab-ci.yml` L1686 key-files glob `test-mempalace-*.sh` (check it still matches something or add the TS file); `.github/workflows/build.yml` L1459 (same glob); comments in `scripts/tests/test-mcp-daemon.sh` L367, `mempalace-transcript-daemon.test.ts` L7, `mempalace-transcript-args.test.ts` L6 and the `fixtures/mempalace-transcript/stub-daemon.ts` header.

##### `scripts/tests/test-palace-path-propagation.sh` (179 lines)

- **Replacement suite.** Retired under spec 0215 R13: it sources `scripts/lib/common.sh` and calls `install_mcp_launcher`, `_materialise_chroma_unit`, `mcp_token_path` in-process. Retirement is conditional on the new consumer-level file below landing first (A1-A4 are uncovered today; grep found no `CONFIGURED_PALACE_PATH` in `service-program-install.test.ts` or `mcp-launcher-lifecycle.test.ts`). `setup-chroma-unit.test.ts` is NOT edited (decision); A10 lives in the new file.

| replacement file | what it holds | est. lines |
|---|---|---|
| `scripts/tests/service-launcher-palace-path.test.ts` (new) | `installLauncherProgram` (`scripts/lib/service/program-install.ts`) into a temp dir with `palacePath: ""` and `"/tmp/custom/palace/location"`: written launcher text (A1-A3), launcher entry run with a stubbed python asserting the child env `MEMPALACE_PALACE_PATH` (A4, behavioural), and the service-custom-path leg via `materialiseChromaUnit` (`scripts/lib/setup/chroma-unit.ts`) with `MEMPALACE_PALACE_PATH` for the systemd flavour (A10) | ~130 |

- **Assertion mapping.** Substitute = the consumer-level test that asserts the behaviour once the Bash file is gone.

| label | behaviour asserted | substitute consumer-level test | MUST survive |
|---|---|---|---|
| A1 | unset palace -> `CONFIGURED_PALACE_PATH=""` | `service-launcher-palace-path.test.ts::empty palace path` (NEW) | `CONFIGURED_PALACE_PATH: string = ""` |
| A2 | no residual `__MEMPALACE_PALACE_PATH__` | same file::no placeholder residue, both states (NEW) | token `__MEMPALACE_PALACE_PATH__` absent |
| A3 | set -> configured value substituted | same file::custom palace path (NEW) | `/tmp/custom/palace/location` (use `path`-aware expectation; macOS `/tmp` symlink) |
| A4 | launcher exports the configured path to the daemon env | same file::child env carries `MEMPALACE_PALACE_PATH` (NEW, behavioural; the shell-string form dies with the shell template in J4) | env value equals the configured path; unset when `""` |
| A5 | plist default `<string>$HOME/.mempalace/palace</string>` | `setup-chroma-unit.test.ts` L97-114 | home-based default |
| A6 | plist: no `__CHROMA_PALACE_PATH__` residue | `setup-chroma-unit.test.ts` residual-placeholder refusal | placeholder absent |
| A7 | plist custom `<string>/var/data/custom-palace</string>` | `setup-chroma-unit.test.ts` L97-114 (value `/data/palace`, same behaviour) | `MEMPALACE_PALACE_PATH` wins when non-empty |
| A8 | plist custom: no residue | `setup-chroma-unit.test.ts` | same as A6 |
| A9 | systemd service default (Bash only asserts no residue) | `setup-chroma-unit.test.ts` L84 | `--path %h/.mempalace/palace` (stronger than Bash) |
| A10 | service custom -> `--path /var/data/custom-palace` | `service-launcher-palace-path.test.ts::service unit custom path` (NEW; today only `service-dual-source-conformance.test.ts`, Linux-only and retired with J4) | `--path` followed by a space, plus the custom value |
| A11 | service custom: no residue | same new file | placeholder absent |
| A12 | start-script fallback (comment only, no assertion in this file) | `chroma-lifecycle.test.ts` (spec 0252 R21) | n/a |
| A13 | `mcp_token_path` == launcher-style token path (sha256 of `cd -P` resolved palace, first 24 hex) | `service-launcher-token.test.ts` L99-112 (`tokenFilePath` == `mcp.tokenPath` == `derivedTokenPath`), `mempalace-transcript-token.test.ts` (symlink, missing parent) | 24 hex of sha256 of the resolved palace |

- **Changed or dropped assertions.** A4 changes from a shell-string grep (`export MEMPALACE_PALACE_PATH="${CONFIGURED_PALACE_PATH}"`) to a behavioural env check on the TS launcher (`if (CONFIGURED_PALACE_PATH !== "") env.MEMPALACE_PALACE_PATH = ...`): the shell template is retired in J4. A13 compared two Bash snippets; the TS substitutes are strictly stronger. The Bash-only `sed` delimiter weakness (a `|` or `&` in the path) is not ported; adding a path containing `&` to the new file is optional extra, not parity. Real-HOME write by `install_tls_exec_wrapper` disappears with the sourced calls.
- **Mutation set.** `scripts/lib/service/launcher/mcp-daemon-launcher.ts`: drop the `CONFIGURED_PALACE_PATH !== ""` export -> A4. `scripts/lib/service/program-install.ts`: skip the `__MEMPALACE_PALACE_PATH__` substitution -> A1-A3. `scripts/lib/setup/chroma-unit.ts`: ignore `MEMPALACE_PALACE_PATH` in the service flavour -> A10; hard-code the default -> A5/A7. `scripts/lib/service/launcher/launcher-token.ts`: hash the unresolved path -> A13 (existing substitute tests).
- **Platform.** New file: render and text assertions run on all platforms (use `path.join` expectations); the launcher-entry env leg is POSIX-only (stub python is a shell script; `skip` on win32 with that reason). The systemd unit leg is a pure render and runs everywhere.
- **Static reads and wiring.** `ci/shell-allowlist.txt` L193; `ci/ci-capabilities.yml` L2256, L2275, L2301, L2322; `.gitlab-ci.yml` L1827, L1845-1852, L1858, L1876; `.github/workflows/build.yml` L1560 (path filter), L1591-1615 (`hashFiles` and `--key-files` lists, drop the name and add the new TS file). `scripts/tests/test-mcp-daemon.sh` stays (L1130-1139 palace path token cases): VERIFY it is not retired by another row before it is cited as a substitute.

#### Worktree and upstream sync (pull request B)

##### `scripts/tests/test-sync-from-upstream.sh` (3273 lines)

- **Replacement suite.** Shared helper listed once: `scripts/tests/lib/sync-fixture.ts` (~150): realpath tmp root, `GIT_CONFIG_GLOBAL` file (user, `commit.gpgsign=false`, `autocrlf=false`) + `GIT_CONFIG_NOSYSTEM=1`, `initRepo`, `commitFiles`, `makeAdopter` (TOML with forward slashes, TAB manifest lines, config+manifest COMMITTED), `runSync` (spawns `process.execPath scripts/sync-from-upstream.ts`, captures stdout/stderr always), `commitIsSigned` (header block only, `^gpgsig` no trailing space), `dirtyReport`, `cloneShallow` (`file://` + `--depth 1`), tree-compare, ssh-signing capability probe.

| replacement file | holds | est. lines |
|---|---|---|
| `sync-from-upstream-policies.test.ts` | G1, G2, G4, vv, bbb | ~230 |
| `sync-from-upstream-reconcile.test.ts` | G3 | ~200 |
| `sync-from-upstream-orphans.test.ts` | G5, G7, G10 (qq-ss, uu-aaa) | ~260 |
| `sync-from-upstream-dirty-report.test.ts` | G9 (data-driven) | ~150 |
| `sync-from-upstream-preserve.test.ts` | G6 | ~260 |
| `sync-from-upstream-signing.test.ts` | G8 | ~260 |

- **Assertion mapping.** Every test also asserts exit code. The 4 Bash `run_case` helpers discard output for exit-only cases; TS captures it and prints it in assert messages.

| label | behaviour | replacement::test | verbatim / exact values |
|---|---|---|---|
| 1 | clean core: exit 0, upstream content, `git diff --cached` empty | policies::clean core | empty cached diff |
| 2 | dirty strict file: exit 1, stderr names it, worktree untouched | policies::strict dirty aborts | `core-file.txt` |
| 3, 4 | `canonical_repo=""` / key absent: exit 1, stderr names it | policies::canonical_repo missing/empty | `canonical_repo` (the "no fetch" claim is unasserted in Bash; do not invent) |
| a | strict `specs` + excluded `specs/org`: core restored, org file untouched | policies::excluded nested | exit 0 |
| b | adopt-on-edit equal to upstream v2: content v2 | policies::adopt equal | v2 |
| c | adopt-on-edit modified, never upstream: frozen, exit 0 | policies::adopt frozen | content unchanged |
| d | strict `AGENTS.md` local edit: exit 1 names it | policies::strict AGENTS.md | `AGENTS.md` |
| e | `.crewrig` strict + `.crewrig/.synced-markers` excluded: marker survives | policies::marker carve-out | exit 0 |
| f | adopt-on-edit, blob = older upstream v1: updated to v2 | policies::stale fork updates | v2 |
| g | adopt-on-edit, matches no upstream: frozen; marker `.crewrig/.synced-markers/README.md.sha` equals `git hash-object` of adopter blob | policies::marker records blob | marker path, hash equality |
| h | new upstream file ADDed with upstream fetched as remote `canonical` | reconcile::add via named remote | exit 0, file present |
| i | org committed-then-deleted file not re-created | reconcile::org-deleted stays gone | |
| j | customised member frozen | reconcile::customised frozen | |
| k | untouched member = older upstream blob: updated | reconcile::untouched updated | |
| l | org-deleted, upstream re-touches, TWO syncs: stays gone | reconcile::two syncs | first exit ignored |
| m | shallow adopter: exit 0, stderr "shallow", new file NOT added | reconcile::shallow | `shallow` |
| n | phantom strict + resolvable sibling: exit 0, warning exactly once, sibling v2 | policies::phantom warns once | `Warning: skipping manifest entry absent from upstream: phantom.txt` count==1 |
| o | resolvable manifest: no warning | policies::no warning | absence of `Warning: skipping manifest entry` |
| p | bare strict, blob = older upstream: updated | policies::older-upstream strict | v2 |
| q | strict dir, upstream adds file: created | policies::new file in strict dir | |
| r | strict `scripts`, upstream deleted `old-file.sh`: removed, active kept | orphans::upstream-deleted | `Removed (upstream-deleted): scripts/old-file.sh` |
| s | strict `specs` + excluded `specs/org`, org-only file kept | orphans::excluded not removed | no `Removed` line for `specs/org` |
| t | `--preserve-history` vs plain: upstream sha ancestor of HEAD, files identical to plain run | preserve::graft equals plain | ancestor check |
| u | full clone + config commit: HEAD unchanged, `no-op`, exit 0 | preserve::no-op | `no-op` |
| v | shallow: exit != 0, mentions shallow (case-insens.), no `Fetching`, HEAD and core-file unchanged | preserve::shallow refuses | absence of `Fetching` |
| w | uncommitted unrelated.txt: exit != 0, path printed, core-file already restored v2, edit kept, HEAD unchanged | preserve::R8 guard (table) | restore-before-guard order |
| x | uncommitted `specs/org/custom.md` (excluded nested under strict): same as w | preserve::R8 guard (table) | strict parent restored |
| y | uncommitted `AGENTS.org.md` (top-level excluded): blocks | preserve::R8 guard (table) | |
| z | strict `.github/copilot` + excluded `settings.json` mutated: exit 0, kept, `extension.json` unchanged | orphans::copilot carve-out | |
| aa | `extension.json` mutated: exit 1 names `.github/copilot`, edit kept | orphans::carve-out not too wide | `.github/copilot` |
| bb | REAL repo `.gitignore`: `git check-ignore` true for `.github/copilot/settings.json.bak.20260723-203351`, false for `extension.json` | orphans::gitignore bak pattern | skip if not a git checkout |
| cc | ssh signing: exit 0, HEAD moved, signed, 2 parents (p1 = pre-tip, p2 = upstream sha), upstream ancestor | signing::signed graft | `(signed)` |
| dd | gpgsign false: unsigned, no `(signed)`, stderr has no `/[Ss]ign/` | signing::unsigned | |
| ee | signingkey nonexistent: exit != 0, tip unmoved, restore already in worktree (v2) | signing::missing key refuses | `refuses to commit — this repository is configured to sign` (em dash, UTF-8) |
| ff | no-op with gpgsign true + absent key: exit 0, HEAD unchanged, `no-op` | signing::no-op probes first | `no-op` |
| gg | `commit.gpgsign=yesplease`: exit != 0, tip unmoved | signing::unreadable boolean | `cannot determine whether to sign` |
| hh | `gpg.ssh.program` sh stub writes empty `.sig`: exit != 0, tip unmoved | signing::unsigned post-condition | `built an unsigned commit` |
| ii | gpgsign UNSET, HOME/XDG empty, `GIT_CONFIG_NOSYSTEM=1`, NO `GIT_CONFIG_GLOBAL`: unsigned, no `(signed)` | signing::unset is unsigned | |
| jj | sha256 repos both ends; premise `^gpgsig-sha256` plus a trailing space, via `commit-tree -S`; sync signed | signing::sha256 | `(signed)`, `rev-parse --show-object-format`==sha256 |
| kk | one modified member of strict `tools` | dirty-report::table row | whole line `tools/alpha.sh` (two leading spaces) once, `tools` (two leading spaces) absent, exit 1 |
| ll | three members incl. nested | dirty-report::table row | each once, `tools` absent |
| mm | `papers` + `papers/index.json` both strict | dirty-report::dedup | `papers/index.json` exactly once |
| nn | entries `container` and `b`; files `container/name b` and `b` | dirty-report::space in name | both lines present |
| oo | guidance text, exit 1 | dirty-report::guidance | `Never restore the containing directory`, `Restore ONLY the files listed above` |
| pp | helper self-test (ssh signing capable) | signing::capability precheck | see Changed |
| qq | `.claude/agents` regenerable diverged: restored | orphans::regenerable restore | `Restored (diverged, regenerable): .claude/agents/dev.md` |
| rr | `.claude/skills` strict diverged: exit 1 names path | orphans::strict not regenerable | |
| ss | strict vs regenerable, no divergence: both exit 0; `.claude` trees, `other.txt`, stdout, stderr equal | orphans::differential | `diff -r` becomes recursive tree compare |
| tt-1/2 | `--preserve-history` + regenerable change: exit 0; ungoverned `notes.md`: exit 1 names it | preserve::regenerable vs ungoverned | fixture commit via `add -A` (avoids R11 no-op) |
| uu | regenerable orphan `.claude/agents/old/AGENT.md` removed, active kept | orphans::regenerable orphan | `Removed (upstream-deleted): .claude/agents/old/AGENT.md` |
| ww | retired `.claude/agents/dev/AGENT.md` removed, `dev.md` restored, diverged `tester.md` restored | orphans::nested retired | both report lines; empty-dir residue not asserted |
| vv | strict `model-mappings` + excluded `claude.org.yml` modified: untouched | policies::excluded file | exit 0 |
| xx | org skill source `artifacts/org/skills/org-helper` + compiled `.claude/skills/org-helper/SKILL.md` kept, core skill kept | orphans::org skill kept | no `Removed` line |
| yy | same for `.gemini/commands/org-cmd.toml` | orphans::org command kept | |
| zz | upstream-deleted core skill removed + report | orphans::core skill orphan | `Removed (upstream-deleted): ...` |
| aaa | compiled skill with no org source removed | orphans::compiled orphan | `Removed (upstream-deleted): ...` |
| bbb | strict `ci` + excluded `ci/org`: file survives unchanged | policies::ci/org | no `Removed ... ci/org` |

- **Changed or dropped assertions.** `pp` is a self-test of a Bash helper; becomes a capability probe that `skip`s signing tests only on win32 and fails loudly elsewhere (original hard-FAILed). Global git config is now isolated for every case (Bash leaked `~/.gitconfig` except `ii`); strengthening only. Else none.
- **Mutation set.** Targets in `scripts/lib/sync-from-upstream/`, edited on a temp copy.

| mutant | edit | red |
|---|---|---|
| M1 | `apply.ts`: drop excluded-path skip | a, s, z, vv, bbb |
| M2 | `blobs.ts`: compare to HEAD only, not upstream history | f, k, p |
| M3 | `manifest.ts`: emit phantom warning twice or abort | n, o |
| M4 | `preserve-history.ts`: run R8 guard before restore | w, x, y |
| M5 | `preserve-history.ts`: skip signing probe on no-op | ff |
| M6 | `preserve-history.ts`: `gpgsig` (plus trailing space) regex without sha256 variant | jj |
| M7 | `preserve-history.ts`: drop post-update-ref signed check | hh |
| M8 | `dirty.ts`: space-delimited seen-set / no dedup | nn, mm |
| M9 | `reconcile.ts`: ignore shallow | m, v |
| M10 | `org-components.ts`: delete org-compiled outputs | xx, yy, aaa |

- **Platform.** windows-latest: policies, reconcile, orphans, dirty-report, preserve (paths slash-normalised, as `sync-from-upstream-windows.test.ts` proves). POSIX-only (skip with reason `ssh-keygen -Y sign` and sh stub): `signing` whole file. VERIFY: whether `preserve` tt/w cases touch the unix-only stub; none expected.
- **Static reads and wiring.** Case bb reads the real `.gitignore` (line 43 `.github/copilot/settings.json.bak.*`). Wiring naming the suite: `ci/shell-allowlist.txt:214`; `.gitlab-ci.yml:1490,1500,1514`; `.github/workflows/build.yml:1260,1281`; `ci/ci-capabilities.yml:1893,1908,1922`; `scripts/tests/check-stray-scan-wiring.test.ts` (VERIFY); specs 0199/0201/0148/0253/0121 docs only.

##### `scripts/tests/test-worktree-claim.sh` (1599 lines)

- **Replacement suite.** Reuse `scripts/tests/lib/worktree-fixtures.ts` (`makeFixture`, `runClaim`, `CLAIM_SH`, `cleanEnv`, `SKIP_POSIX`). New helper `scripts/tests/lib/worktree-claim-asserts.ts` (~70): `ledgerHas`, `ledgerLacks` (fails if ledger absent), `plantSince`, `sameBytes`.

| replacement file | holds | est. lines |
|---|---|---|
| `worktree-claim-ported-basic.test.ts` | 1-8, 15 | ~230 |
| `worktree-claim-ported-guards.test.ts` | 9, 11, 12, 13, 14, 16, 23, 24 | ~250 |
| `worktree-claim-ported-arith.test.ts` | 17-22 (table-driven) | ~200 |

- **Assertion mapping.** Bash records one PASS per case; TS asserts each item listed.

| case | behaviour | replacement::test | must survive |
|---|---|---|---|
| 1 | take on clean wt, claim dir under common-dir, status, ledger | basic::take | `Claimed '736' for 'alice'.`; ledger `take\talice\t736` |
| 2 | second take by bob: exit 4, holder unchanged | basic::second take | `already claimed by another agent`; rc 4 (script's own) |
| 3 | modified tracked file: exit 5, no claim dir, NO ledger | basic::dirty gate | `carries uncommitted changes`, `M tracked.txt` |
| 4 | untracked file in untracked dir | basic::untracked all | `?? newdir/nested/f.txt`, not `?? newdir/` |
| 5 | holder release, then bob takes | basic::release | `holder: bob` |
| 6 | non-holder release: 4, claim survives | basic::non-holder | `held by 'alice', not by 'bob'` |
| 7 | history after release | basic::history | `entries: 2`, regex `^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ\trelease\talice` |
| 8 | takeover fresh refused; `--stale-after 0` succeeds; tracked AND untracked residue byte-identical vs copies outside wt | basic::takeover | `not stale`; `Took over '736' from 'alice'`; ledger `takeover\tbob\t736\tdisplaced=alice` |
| 9 | claim survives `git clean -fdxq` (precondition: doomed.txt really removed) | guards::survives clean -fdx | status claimed/alice (NOT covered today) |
| 10 | `run true` 0, `run sh -c 'exit 42'` 42, claim gone, ledger `release\talice\t736\trun`, bob can take | covered by `worktree-claim-run` scenario 12; add one row to basic | `run`-tagged ledger line; use `process.execPath -e` for the exit |
| 11 | after `git worktree remove`: history/status from main checkout; no `--ticket` refused; `CREWRIG_REPO_DIR` from outside repo | guards::main-checkout reads | `entries: 2`, `state: unclaimed`, `last-holder: alice`, `last-action: release`, `last-at: <ISO>`, message mentions `--ticket` |
| 12 | claim-root identical across 4 cwds == physical | guards::claim-root | symlink leg skip when `fx.link` null |
| 13 | after takeover, `run --agent bob -- git reset --hard`: 5, tracked.txt byte-identical, claim still bob | guards::no waiver real reset | `carries uncommitted changes` |
| 14 | run re-entrant for holder | guards::re-entrance | ledger `run-reentrant\talice\t736`; bob take 4; no `release alice` line |
| 15 | takeover on unclaimed (dirty) wt: 4, no claim dir | basic::takeover unclaimed | `not claimed`, mentions `take` |
| 16 | takeover inside in-flight run survives; interloper (outside wt, `node interloper.mjs`, not bash) back-dates `since_epoch` 1h | guards::takeover in run | run exit 0 + `Took over`; carol take 4; no `release\talice`; takeover displaced=alice |
| 17 | `--stale-after 08` | arith::leading zero | rc 4, `not stale`, `stale-after-seconds: 480`, no takeover ledger |
| 18 | three wide values `200000000000000000`, `999999999999999999999`, `307445734561825861` | arith::wide stale-after | rc 1, `is out of range`, value echoed verbatim |
| 19 | `since_epoch` = `08` | arith::since_epoch 08 | rc 0, `Took over`, displaced=alice |
| 20 | `since_epoch` = 2^64+now (20 digits, string concat, assert length 20) | arith::wrap | takeover rc 0 |
| 21 | future `since_epoch`, all three arms run | arith::skew | now+300: rc 4, `not stale`, `held-for-seconds: 0`; now+900: rc 0; `100000000000000000`: rc 0 |
| 22 | `take --agent` flag last | arith::value-less flag | rc 1, `'--agent' requires a value` |
| 23 | `CREWRIG_REPO_DIR=A`, cwd in B: `run -- touch marker.txt` | guards::repo-dir wins | marker in A not B (use node -e) |
| 24 | `run -- pwd -P` from wt/sub | guards::run cwd | stdout EQUALS `realpathSync.native(wt)` |

- **Changed or dropped assertions.** Dropped: the ~1000 comment lines (mutation matrix prose); `want_no_shell_error` (shell-only property, TS has no bash expansion). Optional 15-line arith header: assert the value, not only the rc. Cases 10, 14, 16, 23, 24 are strong in existing TS files, ported only as thin rows. Case 16 interloper moves from bash to node; claim run uses TS entry plus one shim leg.
- **Mutation set.** Targets in `scripts/lib/worktree-claim/`, temp copy. Recorded Bash matrix, re-aimed:

| mutant | edit | red |
|---|---|---|
| W1 | `staleness.ts`: whole width/range fix reverted | 17, 18, 19, 20 |
| W2 | leading zero treated as default 30 | 17 at `stale-after-seconds: 480` |
| W3 | `takeover.ts`: write claim state before staleness verdict | 17 at `holder: alice`, 8 |
| W4 | range bound after the multiply | 18 at `307445734561825861` |
| W5 | range check avoiding multiply (plain comparison) | 18 at `999999999999999999999` |
| W6 | `since_epoch` fails closed (empty age) | 19, 20, 21 rc |
| W7 | `since_epoch` width guard dropped | 20 rc |
| W8 | zero arm dropped | 19 rc |
| W9 | skew band reverted; clamp dropped; any negative age corrupt; tolerance tied to `--stale-after`; absurd age floored to zero | 21 per arm (`held-for-seconds` value, now+300, now+900, 18-digit) |
| W10 | `args.ts:52` value-flag guard dropped | 22 diagnostic only |
| W11 | `run.ts`: run not at toplevel / subshell without cd | 23, 24 (Bash recorded two DEAD rows; keep as non-claims) |
| W12 | `takeover.ts`: add `git checkout -- .` or `clean -fd` | 8 residue, 13 |
| W13 | `store.ts`: put claim in worktree dir | 9 |
| W14 | `ledger.ts`: ledger inside claim dir | 7 |
| W15 | `take.ts`: mkdir before gate | 3 |

- **Platform.** windows-latest: all three files via TS entry (portable `process.execPath -e` instead of `sh`/`touch`). POSIX-only: shim leg (`CLAIM_SH`, needs bash) and symlink arm of 12, `SKIP_POSIX`.
- **Static reads and wiring.** Suite reads no repo text beyond `-f scripts/worktree-claim.sh` (exit 2). Wiring: `.github/workflows/build.yml` ~1563 paths filter and stray-scan; `.gitlab-ci.yml:1830,1861,1879`; `ci/ci-capabilities.yml:2259,2278,2304,2325`; `ci/shell-allowlist.txt:224`; comments in `scripts/worktree-claim.sh:4` and `lib/worktree-fixtures.ts:7`.

##### `scripts/tests/test-worktree-git-guard.sh` (101 lines)

- **Replacement suite.** One file `scripts/tests/worktree-git-guard-ported.test.ts` (~90 lines), no new helper. Uses `lib/worktree-fixtures.ts` (`runGuard`, `GUARD_SH`, `makeFixture({ticket:"771"})`, `cleanEnv`). Table of 9 rows `[name, payload, cwd, expectedStatus]` run through `GUARD_TS` (all platforms) and `GUARD_SH` (POSIX).
- **Assertion mapping.** Exit code is the only Bash assertion; TS also asserts stdout empty on allow and stderr contains `worktree` on refuse.

| case | behaviour | replacement::test | must survive |
|---|---|---|---|
| 1 | `.cwd` outside worktrees + `git reset --hard`: 0 | ported::outside scope | exit 0 |
| 2 | worktree cwd + `git status`: 0 | ported::safe command | exit 0 |
| 3 | worktree + `git reset --hard`, no claim: 1 | ported::reset refused | exit 1 |
| 4 | worktree + `git clean -fd`: 1 | ported::clean refused | exit 1 |
| 5 | agy `.toolCall.args.CommandLine=git reset --hard`, process cwd = worktree: 1 | ported::agy CommandLine | exit 1 |
| 6 | agy `git status`: 0 | ported::agy safe | exit 0 |
| 7 | agy bare `git stash`: 1 | ported::stash refused | exit 1 |
| 8 | agy `.toolCall.args={cmd:"git reset --hard"}` object fallback: 1 | ported::args object | exit 1 |
| 9 | no `.cwd`, `workspacePaths[0]` = worktree, `git clean -fd`, process cwd not a worktree: 1 | ported::workspacePaths | exit 1 |

- **Changed or dropped assertions.** Strengthened: "no claim" is now explicit (hermetic fixture, unclaimed, process cwd pinned to non-repo temp dir) instead of accidental; `cleanEnv()` scrubs `CREWRIG_REPO_DIR`/`GIT_*`. Existing `worktree-guard-payload/phrases/decision` tests already cover 1-9 at least as strongly; the ported file is the 1:1 replacement. Dropped: the `Results: p/n` runner (framework concern).
- **Mutation set.** Target `hooks/worktree-git-guard.ts` temp copy.

| mutant | edit | red |
|---|---|---|
| G1 | allow everywhere (enforcement dead) | 3, 4, 5, 7, 8, 9 |
| G2 | claim lookup returns "claimed" on error | 3 |
| G3 | drop `.toolCall.args.CommandLine` extraction | 5 |
| G4 | drop object-text fallback | 8 |
| G5 | drop `workspacePaths[0]` from cwd chain | 9 |
| G6 | stash exemption widened to bare `git stash` | 7 |
| G7 | refuse outside `.worktrees/` | 1 |
| G8 | refuse safe commands | 2, 6 |

- **Platform.** windows-latest: `GUARD_TS` leg (paths via `path.join` under realTmp). POSIX-only: `GUARD_SH` shim leg (bash), `SKIP_POSIX`.
- **Static reads and wiring.** No static reads. Wiring: `.github/workflows/build.yml` paths ~1411 and stray-scan ~1545; `.gitlab-ci.yml:1659,1712,1745,1775`; `ci/ci-capabilities.yml:2063,2097,2139,2170,2246`; `ci/shell-allowlist.txt:225`; specs 0170 delta-01, 0248. Ensure the CI `*.test.ts` glob catches the new name (not `worktree-guard-*`).

#### Usage store and attribution (pull requests A, C and D)

##### `scripts/tests/test-usage-record-schema.sh` (145 lines)

- **Replacement suite.**

| replacement file | what it holds | est. lines |
|---|---|---|
| `scripts/tests/usage-record-schema.test.ts` | one `test()` per file of the 3 sweeps (samples, mutants, derivation) via sorted `readdirSync`; 3 non-empty guards; ajv-installed guard; zero-for-unread "tokens" check | ~90 |

No helper. `spawnSync(process.execPath, [scripts/lib/usage-record-validator.js, file])`, stdout+stderr merged (Bash used `2>&1`). Repo root via `import.meta.dirname`.

- **Assertion mapping.**

| Bash group | behaviour asserted | replacement::test intent | strings that MUST survive |
|---|---|---|---|
| samples, L80-94 | each of the 6 `schemas/usage-record/samples/*.json` (antigravity, claude-code, copilot-cli, correction, gemini-cli, uncaptured) exits 0 and prints OK | `samples/<file> validates` x6 | exit 0; output includes `: OK` |
| samples non-empty guard | R17/R18: dir has >=1 file | `samples dir is non-empty` | count>0 |
| mutants, L96-120 | each of the 7 `scripts/tests/fixtures/usage-records/mutants/*.json` (elided-with-raw, externalized-without-ref, missing-fidelity, missing-reasoning, missing-record-id, price-present, zero-for-unread) exits 1 and is rejected BY the schema | `mutants/<file> rejected by schema` x7 | exit 1; output includes `: schema` (plus trailing space) |
| mutants non-empty guard | dir has >=1 file | `mutants dir is non-empty` | count>0 |
| extra, L110-116 | `zero-for-unread.json` output mentions the all-zero block | `zero-for-unread names tokens` | output includes `tokens` (PLAN v3-F1 remediation 2) |
| derivation, L122-138 | `derivation/recordid-mismatch.json` exits 1, reports derivation failure, NOT a schema failure | `recordId mismatch is not a schema failure` | exit 1; includes `recordId mismatch`; does NOT include `: schema` (plus trailing space) |
| derivation non-empty guard | dir has >=1 file | `derivation dir is non-empty` | count>0 |
| preflight | `node_modules/ajv` present (Bash exit 2, never a silent pass) | `ajv is installed` (assert, never skip) | message must not contain the shell phrase scanned by the stray guard |

- **Changed or dropped assertions.** None. The node-absent preflight is dropped (the test runner is node). The ajv preflight becomes a hard failing test instead of exit 2.
- **Mutation set.** No in-suite mutations. Proof mutants, on a temp copy of `schemas/usage-record/v1.schema.json` plus `scripts/lib/usage-record-validator.js` (VERIFY: how the validator locates the schema, copy the tree if it is `__dirname`-relative): (1) delete the `price` constraint, expect `price-present` red (exit 1 lost); (2) loosen the all-zero tokens rule, expect `zero-for-unread` red; (3) delete the recordId derivation check in the validator copy, expect `recordid-mismatch` red; (4) make the validator emit `recordId mismatch` before schema validation, expect every mutant's `: schema` (plus trailing space) red. Never mutate tracked files. Do not reformat the literal U+001F in `UNIT_SEPARATOR`.
- **Platform.** Entire file runs on windows-latest (no POSIX dependence). Match output suffixes with `includes`, not whole-line regexes (path separators differ).
- **Static reads and wiring.** `.github/workflows/usage-record-schema.yml` L9, L18 (paths filters), L46 (`ci-cache-guard.sh --stray-scan -- bash ...`); `.gitlab-ci.yml` L2754, L2760, L2768; `ci/ci-capabilities.yml` L3530, L3539, L3548; `ci/shell-allowlist.txt` L221; comments in `scripts/tests/test-usage-capture.sh` L11 and `scripts/tests/lib/usage-capture-derive.js` L4. Re-point to `node --test scripts/tests/usage-record-schema.test.ts`.

##### `scripts/tests/test-usage-storage.sh` (1726 lines)

- **Replacement suite.** Each file gets its own `mkdtemp` root and its own `MEMPALACE_PALACE_PATH` (node --test runs files in parallel; token hash derives from the palace path). Writes run in a fresh child per record (journal.js reads env at require time). Mutants run against a COPY of `scripts/lib/usage-store` (plus `usage-capture`, validator dir, schemas as needed; symlink `node_modules`), never tracked files.

| replacement file | what it holds | est. lines |
|---|---|---|
| `scripts/tests/lib/usage-storage-rig.ts` (shared, also used by the mirror suite where useful) | sandbox, env builder (set USAGE_ROOT, PALACE, MIRROR=0; delete the 5 unset vars), `makeRecord` (recordId = sha256(session + U+001F + idem)), `writeRecord` via driver child, path algebra (entry/sidecar/partition/pending/pruned/lock), `periodOf`, `countFiles`, `backdate`, `query`/`prune` via `node scripts/usage-{query,prune}.ts` | ~220 |
| `scripts/tests/lib/usage-storage-driver.cjs` | committed CJS driver: write, resolve-wing, token-path, drain-and-sweep, repair-sidecar | ~70 |
| `scripts/tests/lib/usage-mutants.ts` (shared by storage and attribution; coordinate) | `copyLibTree`, `applyMutation(file, marker, replacement)` that fails loudly if the marker is missing, CRLF to LF normalisation | ~90 |
| `usage-storage-journal.test.ts` | (a),(b),(c),(d),(f),(n) | ~240 |
| `usage-storage-query.test.ts` | (e),(e2), `--undrained` part of (k), MUT-3 | ~210 |
| `usage-storage-gate.test.ts` | (g1),(h),(g2), MUT-2 | ~230 |
| `usage-storage-wing.test.ts` | (i),(j), MUT-1 | ~210 |
| `usage-storage-drain.test.ts` | (k),(k2),(l) | ~230 |
| `usage-storage-prune.test.ts` | (m),(m2),(o) | ~250 |

- **Assertion mapping.**

| Bash label | behaviour asserted | replacement::test intent | strings or values that MUST survive |
|---|---|---|---|
| (a) L340 | each of 6 `schemas/usage-record/samples/*.json` written: STATUS=stored, entry at `journal/<cli>/<YYYY-MM>/<rid>.json`, sidecar `<rid>.wing.json`, entry re-validates via `usage-record-validator.js` (exit 0, `: OK`); vacuity guard | journal::`sample <f> stored with entry+sidecar+valid` x6 | `STATUS=stored`; `.wing.json` |
| (b) L388 | rewrite of each sample returns duplicate | journal::`rewrite is duplicate` x6 | `STATUS=duplicate` |
| (c) L402 | `MR_CORRECTS` correction stored as a new entry; base entry sha256 and mtimeMs unchanged | journal::`correction leaves base untouched` | sha256 and mtimeMs equality |
| (d) L448 | 7 files of `scripts/tests/fixtures/usage-records/mutants/` rejected, `REASON=` present, `journal/` and `mirror/` file counts unchanged; vacuity guard | journal::`mutant <f> rejected, zero files written` x7 | `STATUS=rejected`; `REASON=` |
| (e) L482 | R1-R5 across cli: `--session`, `--agent`+`--parent`, `--task-key`, `--asset kind:ref`, `--period`+`--cli`, +`--fidelity` each return exactly the id set; every line has `schemaVersion`, no `wingDerivation`; `--agent` alone refused (R15) | query::`selector <s> returns exact id set`; `no sidecar leak`; `agent alone refused` | `wingDerivation` absent; R15 refusal exit status |
| (e2) L577 | #1205 composed selectors ANDed: `--period`+{task-key, asset, session, agent+parent}; `--session`+`--cli` match and mismatch (empty); `--asset bad` exits 2 | query::`composed selectors AND`; `bad asset exits 2` | `--asset must be <kind>:<ref>`; exit 2 |
| (f) L617, wave 2 L685 | 8 concurrent writers, one partition: all stored, 8 entries + 8 sidecars, each parses whole, filename == recordId; wave 2 = 2 replays duplicate + 6 new concurrently, 14 entries | journal::`8 concurrent writers` (Promise.all of spawned children), `replay wave` | counts 8, 8, 14 |
| (g1) L729 | stub `bash` on PATH intercepts `usage-mirror.sh` (sentinel): no token file and `CREWRIG_USAGE_MIRROR=''` means no `mirror/` and no spawn; after token file exists, exactly 1 pending marker, 0 mirrored | gate::`no token: no mirror dir, no spawn`; `token present: 1 pending, 0 mirrored` | sentinel; counts 1 and 0 (VERIFY sentinel: `mirror.js` L276 now spawns `bash <scriptPath> --from-write`, see 0253 delta-01 about the `bash` stub sentinel at Bash l.220) |
| (h) L799 | Node `tokenPath()` equals `bash -c '. scripts/lib/common.sh; mcp_token_path'`, for existing and not-yet-existing palace path | gate::`tokenPath parity` x2 | exact string equality |
| (g2) L823 | fresh `mirror/unreachable.stamp` suppresses spawn (0.5 s absence wait); stamp backdated 15 min allows spawn (poll up to 3 s) | gate::`fresh stamp suppresses spawn`; `expired stamp allows spawn` | 15 min backdate |
| (i) L867 | wing derivation in synthetic repo + linked worktree: root -> `git-common-dir` (wing = basename) + memo count 1 under `cache/wings`; subdir same wing, memo 2; live linked worktree memo 3; removed worktree subpath -> `git-common-dir-ancestor`, no new memo; `unknown` with cwd in repo -> `process-cwd`; `unknown` non-git cwd -> `unknown-residual` wing `unknown`; nonexistent path -> `basename-fallback`; `CREWRIG_USAGE_WING` -> `env-override`, no memo | wing::one test per branch (~7), children with controlled cwd, `realTmp()` for macOS | derivation labels above verbatim; memo counts 1,2,3 |
| (j) L997 | delete sidecar: `readOrRepairSidecar` re-derives and writes right wing; truncate to half: treated missing, rewritten whole | wing::`missing sidecar repaired`; `truncated sidecar rewritten` (self-contained, builds its own entry; Bash coupled to (a)) | rewrite is rename, not `linkSync` EEXIST |
| (k) L1063 | 2 spooled valid records move to journal (+sidecars, spool files gone); schema-invalid spooled left in place; stale tmp/ file (2 h) swept; stale spool dotfile swept; FRESH stray kept; `usage-query.sh --undrained` lists the rejected record | drain::one test per behaviour; query::`--undrained` | `spooled-record`; ages 2 h / fresh |
| (k2) L1161 | `CREWRIG_USAGE_DRAIN_BUDGET_MS=1` with spooled records leaves >0 undrained; next write drains all; `spool/` rmdir'd when empty | drain::`budget bounds one call` | env var name; use 20+ records (1 ms budget is probabilistic) |
| (l) L1216 | live-peer fresh `locks/drain.lock`: write stored, spool untouched, lock left; lock backdated 20 min reclaimed, drain runs, lock released | drain::`live lock respected`; `stale lock reclaimed` | 20 min |
| (m) L1273 | current period refused without `--force` (entry survives), `--force` removes; closed period (now minus 13 months, UTC, day clamped) with pending-only markers prunes with no daemon: entries, sidecar, pending markers removed, `pruned/<cli>/<period>.json` written; write into pruned period rejected `REASON=period-pruned`; `CREWRIG_USAGE_ALLOW_PRUNED=1` overrides; `--unprune` removes marker only, entries not resurrected, plain write succeeds | prune::6-8 tests | `period-pruned`; `pruned/<cli>/<period>.json` |
| (m2) L1417 | `node scripts/lib/usage-store/prune.js --help` exits 0, names `docs/usage-organization.md` and `Removing usage data`, no `<root>/`, no `rm -`; docs heading `## Removing usage data` exists (grep -x); every `scripts/...` token in `docs/usage-storage.md` exists (strip trailing punctuation) | prune::`help text`; `docs heading`; `docs paths exist` | tokens above verbatim |
| (o) L1463 | `node scripts/build-usage-validator.js --check` exit 0 clean; appended line in `validator/validate.js` yields non-zero naming `validate.js` and `drift` | prune::`validator check clean`; `drift detected` (on a copy if the script accepts a root, else serialized in-place with try/finally) | `drift`; `validate.js` |
| MUT-1 L1500 | journal.js skips sidecar link: entry stored, no sidecar | wing::`MUTATION RED sidecar` | marker `const wingInfo = mirror.resolveWing(record.identity.projectRoot);` |
| MUT-2 L1541 | mirror.js token gate neutralised: pending marker appears without token | gate::`MUTATION RED token gate` | marker `if (!fs.existsSync(mcp.tokenPath())) {return;}` (VERIFY exact whitespace; source is multi-line) |
| MUT-3 L1580 | query.js `return records.filter(pred);` to `return records;`: `--period --task-key` / `--asset` return more than R3/R4 | query::`MUTATION RED final filter` | marker `return records.filter(pred);` |
| (n) L1614 | `layout.stateDir()` == `<root>/state`; `<root>/state` never exists after the suite | journal::`state dir never created` (last test, own root) | `<root>/state` |
| 1260-A L1630, 1260-B L1668 | Bash trap-ordering regression | see dropped | `#1260` label |

- **Changed or dropped assertions.** 1260-A and 1260-B (11 assertions in Bash) are DROPPED: they test the Bash EXIT trap and `MUTATION_GUARD_CONFIRMED_CLEAN` ordering, which cannot exist once mutations run on a copy. Replacement in `usage-storage-wing.test.ts` (titled `#1260 mutation helper never touches tracked tree`): after the mutation tests `git diff --quiet` on the mutated lib files, plus `applyMutation` throws on a missing marker. Preflight/FATAL texts and the real-`$HOME` token-dir register/cleanup in (g) are dropped if a temp `HOME`+`USERPROFILE` works (VERIFY `mcp.js` L132 uses `os.homedir()`); then assert the real `~/.mempalace` is untouched via `realHomeGuard`. (k2) strengthened: more records than the Bash 5 to make a 1 ms budget deterministic. Test titles keep `MUTATION RED`.
- **Mutation set.** All on the temp copy of `scripts/lib/usage-store`: MUT-1 `journal.js` drop sidecar link, expect (a) sidecar assertion and wing::sidecar red; MUT-2 `mirror.js` L244 gate removed, expect gate::`no token: no mirror dir` red; MUT-3 `query.js` final filter dropped, expect query::`composed selectors AND` red; additional proposals: `journal.js` skip dedup check (expect (b) red), `journal.js` rewrite base on correction (expect (c) red), `journal.js` write entry before validate (expect (d) file counts red), `query.js` return sidecar fields (expect (e) `wingDerivation`), `prune.js` drop current-period refusal (expect (m) red), `build-usage-validator.js` drift check always exits 0 (expect (o) red).
- **Platform.** POSIX-only with `SKIP_POSIX` reason: gate (bash stub on PATH, `bash -c` parity), drain lock/timing if it relies on bash, journal concurrency test only if it needs `&` (children via `Promise.all` are portable, keep on win). Likely windows-latest: journal, query, wing (use `os.tmpdir()/nonexistent` and expect basename of last segment), prune, record-driven drain. `git worktree` symlink paths in wing: SKIP_WINDOWS if realpath differs (VERIFY). CI today is `ubuntu-latest` only for `.github/workflows/usage-storage.yml`.
- **Static reads and wiring.** `.github/workflows/usage-storage.yml` L24, L57 (`test-usage-storage*.sh` filters, also matches the mirror suite), L98, L101; `.gitlab-ci.yml` L2937-2938, L2962, L2994; `ci/ci-capabilities.yml` L3758, L3791, L3818-3819; `ci/shell-allowlist.txt` L222-223; comment refs `scripts/lib/usage-store/mcp.js` L10, `scripts/tests/fixtures/usage-storage/fake-mempalace-mcp.js` header, `scripts/tests/usage-inventory.test.ts` L4, L20, L38, L44, `scripts/tests/test-usage-pricing.sh` and `test-usage-capture.sh` comments, specs 0253, 0253 delta-01, 0170 delta-01, 0218 (prose, left as history).

##### `scripts/tests/test-usage-storage-mirror.sh` (1844 lines)

- **Replacement suite.** Fake daemon `scripts/tests/fixtures/usage-storage/fake-mempalace-mcp.js` (args port token callLog drawersFile) is kept. Every file starts its own fake on an ephemeral port (never 41893), own `USAGE_ROOT`, own palace path (unique token hash), temp `HOME`+`USERPROFILE` (VERIFY). Pin `CREWRIG_USAGE_WING=usage-storage-mirror-suite`. Each group seeds itself (relative deltas, no inherited 12 drawers or 18 calls).

| replacement file | what it holds | est. lines |
|---|---|---|
| `scripts/tests/lib/usage-mirror-rig.ts` | freePort, startFake/stopFake (fetch `/healthz`), `control`, `toolFailure`, `jsonrpcError`, `sourceToolFailure`, log readers (count by tool, JSONL), drawer readers, `makeRecord`, `writeRecord` (in-process via `createRequire` of `journal.js`, `CREWRIG_USAGE_MIRROR=0`), marker path algebra, `setMarkerMtime`, `runShim`, token install, `waitFor`, quiescence wait (no `mirror.lock`) | ~250 |
| `scripts/tests/lib/usage-mutants.ts` | shared copy-tree mutation helper (see storage suite) | ~90 |
| `usage-mirror-catchup.test.ts` | (a),(b),(c),(f) | ~270 |
| `usage-mirror-prune.test.ts` | (d),(e),(g) | ~250 |
| `usage-mirror-failures.test.ts` | (h),(i),(j), breaker-cap contrast, decoder-throws fault | ~270 |
| `usage-mirror-mutants.test.ts` | reconcile-sidecar, rename, prune-skip, lock race, requireSuccess, dry_run, touch-mtime (each with a green twin) | ~260 |

- **Assertion mapping.**

| Bash label | behaviour asserted | replacement::test intent | strings or values that MUST survive |
|---|---|---|---|
| (a) L439 | fake DOWN, 6 records (5 captured + 1 uncaptured) written with detached spawn enabled: `unreachable.stamp` appears (poll <=5 s), all journaled, all pending, none mirrored | catchup::`daemon down: stamp, 6 pending, 0 mirrored` | counts 6/6/0; `unreachable.stamp` |
| (b) L490 | fake up, `usage-mirror.sh`: exactly 6 `add_drawer` calls, markers pending to mirrored, 6 drawers, uniform wing = env override, `added_by` = `crewrig-usage-store/env-override`, captured drawers: no raw, `rawStatus=externalized`, `rawRef` contains recordId; uncaptured drawer byte-identical to journal entry without `rawStatus`/`rawRef`; `source_file` absolute; second catch-up adds 0 calls | catchup::`catch-up mirrors exactly N`; `slim captured`; `uncaptured byte-identical`; `idempotent` | `externalized`; `crewrig-usage-store/env-override`; call count 6 then +0 |
| (c) L612 | `--reconcile` after `rm -rf mirror/`: +6 calls, still 6 drawers, ids unchanged, last 6 log lines `already_exists`, markers restored; then removing mirror/ + sidecars + changing wing gives +6 calls and drawers grow to 12 | catchup::`reconcile N not 2N`; `no sidecar: re-derived wing` | `"already_exists":true`; deltas +6 and +6 |
| (f) L823 | zero `mempalace_search` calls in the whole log (v2-F2) | catchup::final test/`after()`: log has no `mempalace_search` | `mempalace_search` |
| (d) L678 | daemon stopped: prune refuses non-zero, stderr `daemon is unreachable`, entries survive, drawers untouched; daemon up: succeeds, exactly 6 `delete_by_source`, entries+sidecars+mirrored markers gone, fake holds 0 drawers | prune::`refuses when daemon unreachable`; `prunes with N deletes` | `daemon is unreachable`; `delete_by_source` x6 |
| (e) L751 | 3 gemini-cli mirrored; `failDeleteAfter:1`: prune non-zero, exactly 1 removed, 2 remain; cleared, re-run completes, all 3 removed | prune::`interrupted prune resumes idempotently` | `failDeleteAfter`; 1/2 then 3 |
| (g) L833 | 7 `delete_by_source` shapes (success-false, dry-run, no-success-key, is-error, not-json-text, no-text-content, no-result): non-zero, exactly 1 delete call, stderr `did not confirm` and NOT `unreachable`, marker+entry+sidecar+drawer kept; recovery removes all | prune::`unconfirmed delete keeps record` x7 + `recovery` | `did not confirm`; shape names verbatim |
| (h) L906 | `add_drawer` failures: success-false (2 calls), no-success-key (1), not-json-text (1): exit 0, both markers stay pending, success-false prints 2 `failed:` lines else `stopping this pass`, no `unreachable.stamp`, no drawer; recovery mirrors both | failures::`add_drawer failure <shape>` x3 + recovery | `failed:`; `stopping this pass`; call counts 2/1/1 |
| (i) L1008 | JSON-RPC codes -32000, -32602 => `tool-error`; -32001, -32002, -32003, -32099 => `tool-unavailable` (#1240) | failures::`code <n> classified` (in-process `mcp.addDrawer`) | the six codes and two class names |
| (j) L1044 | breaker=3, 3 poisoned (`sourceToolFailure` by recordId) + 2 healthy with pinned mtimes: pass1 3 calls + `breaker tripped`, healthy not reached; pass2 8 calls (5+3) healthy mirrored, poisoned pending; pass3 3 calls; pass4 steady | failures::`breaker + ordering passes 1-4` | `CREWRIG_USAGE_MIRROR_TOOL_ERROR_BREAKER=3`; `breaker tripped`; 3/8/3 |
| MUT reconcile-sidecar L1219 | sidecar fast path disabled: drawer wing re-derived (suite wing), not `sidecar-original-wing` | mutants::pair (green: sidecar wing honoured; mutant: suite wing) | `sidecar-original-wing` |
| MUT rename dropped L1273 | `fs.renameSync(pendingPath, mirroredPath);` removed: drawer added, marker stays pending | mutants::pair | marker string verbatim |
| MUT prune skips delete L1323 | prune success, local entry gone, drawer count unchanged (orphan) | mutants::pair | `mcp.deleteBySource({ source_file: entryPath, dry_run: false })` block |
| MUT lock race L1381 | hold `locks/mirror.lock` ~0.5 s, explicit catch-up `CREWRIG_USAGE_MIRROR_WAIT_MS=5000` waits and mirrors all 3; mutant swaps `acquireLockWaiting` for `tryAcquireLock`: left unmirrored | mutants::pair (async `spawn`, not `spawnSync`) | 0.5 s hold; WAIT_MS=5000 |
| MUT requireSuccess L1479 | `payload.success === true) return res;` dropped: prune exits 0, drawer survives | mutants::pair | marker in `mcp.js` |
| MUT dry_run L1531 | `dry_run:false` dropped: prune refuses naming `dry run`, last delete log line has `"dry_run":true`; unmutated prune succeeds | mutants::pair | `dry run`; `"dry_run":true` |
| FAULT decoder L1597 | `decodeToolResult` throws: catch-up exit 0, `locks/mirror.lock` released, marker pending, stderr `stopping this pass`; restored then recovers | failures::`decoder throws` (mutated copy) | `function decodeToolResult(parsed) {` |
| MUT breaker cap L1670 | `BREAKER=999999` (env, no source edit): single pass mirrors both healthy | failures::`breaker cap removed` | `999999` |
| MUT touchPendingMarkerMtime L1734 | call removed (regex): 2 passes with BREAKER=3 leave healthy starved; unmutated recovers in 2 | mutants::pair | `touchPendingMarkerMtime(...)` regex |

- **Changed or dropped assertions.** The in-place `git checkout --` restore, `git diff --quiet` dirty-tree guard, and #1250 trap ordering are dropped (Bash-trap property, replaced by copy-tree mutation). Each mutant gains a green twin on the same scenario. MUT reconcile-sidecar: the unmutated run also asserts the sidecar wing is used. The ajv exit-2 preflight becomes a hard test. (f) and cumulative counts become per-file relative counts.
- **Mutation set.** Temp copy of `scripts/lib/usage-store/{mirror,prune,mcp}.js` (+ `journal.js`, `usage-wrapper.ts`, `node-floor-guard.js`, the `usage-mirror`/`usage-prune` entries and shims, symlinked `node_modules`): the eight mutations above, each expected red on its own mapping row (rename removed turns (b) marker move red; prune-skip turns (d) `delete_by_source x6` red; requireSuccess turns (g) `did not confirm` red; dry_run turns the `dry run` refusal red; lock race turns the lock-wait test red; touch removed turns (j)/pass2 red; decoder throw turns the lock-release test red; sidecar path disabled turns (c) red).
- **Platform.** All four files POSIX-only (`SKIP_POSIX`, reason: write-time detached `bash usage-mirror.sh --from-write` spawn at `mirror.js` L276, bash shims, lock/utimes semantics). No windows-latest run. A shim smoke test in catchup stays POSIX.
- **Static reads and wiring.** `.github/workflows/usage-storage.yml` L24, L57, L101; `.gitlab-ci.yml` L2938, L2962, L2994; `ci/ci-capabilities.yml` L3758, L3791, L3819; `ci/shell-allowlist.txt` L222; comments in `scripts/lib/usage-store/mcp.js` L10 (references the common.sh parity step), the fixture header, and `scripts/tests/usage-inventory.test.ts`. Mutation markers live in `.js` libs: loud failure on drift. The fixture `fake-mempalace-mcp.js` stays (referenced only by this suite plus `usage-storage.yml`).

##### `scripts/tests/test-usage-attribution.sh` (1359 lines)

- **Replacement suite.** Entries driven through `node scripts/usage-{query,attribute,prune}.ts` (portable, no bash); the one shim smoke test stays POSIX. Temp `HOME`+`USERPROFILE`; every case its own `CREWRIG_USAGE_ROOT`, palace path, `CREWRIG_USAGE_CAPTURE_TEST=1`, `CREWRIG_USAGE_MIRROR=0`; `CREWRIG_TASK`, `CREWRIG_SESSION_ID`, `CREWRIG_FORGE_HOSTS`, `CREWRIG_TASK_DECLARATION_TTL_MS`, `CREWRIG_USAGE_{WING,ALLOW_PRUNED}` stripped (VERIFY `cleanEnv`). Fixtures stay at `scripts/tests/fixtures/usage-attribution/records/` (35 files).

| replacement file | what it holds | est. lines |
|---|---|---|
| `scripts/tests/lib/usage-attribution-rig.ts` | `usageEnv`, `buildCheckout(dir, branch, remoteUrl?)` (hand-written `.git/HEAD` + `config`), `cli()` spawner, `rollupFig`, `listLines`, path helpers (`journal/<cli>/<period>/<rid>[.wing\|.attr].json`), `recordId`, `walkFiles` | ~190 |
| `scripts/tests/lib/usage-attribution-driver.cjs` | committed driver: resolve, submit, capture-throw, period, sha256-file, ledger-append, declaration-write (JSON argv or `ATTR_*` env) | ~80 |
| `scripts/tests/lib/usage-mutants.ts` | shared copy-tree helper | ~90 |
| `usage-attribution-channels.test.ts` | R25 groups 1-13 | ~230 |
| `usage-attribution-ledger-rollup.test.ts` | R26, R27, R27 failure-record, R28, R29 | ~230 |
| `usage-attribution-period-rollup.test.ts` | delta-01 groups 19-25 | ~230 |
| `usage-attribution-prune.test.ts` | prune (a), (b) | ~160 |
| `usage-attribution-mutations.test.ts` | MUT1-MUT7, static grep, docs path guard, mutation-helper test | ~260 |

- **Assertion mapping.** (Bash numbering from the case list; each id once.)

| Bash case | behaviour asserted | replacement::test intent | strings or values that MUST survive |
|---|---|---|---|
| R25-1 L298 | channel 1 explicit declaration | channels::`ch1 explicit` | channel `explicit`, key `ch1-key`, outcome attributed |
| R25-2 L307 | env channel (`ATTR_CTX_ENV_CREWRIG_TASK`) | channels::`ch2 env` | `env`/`ch2-key` |
| R25-3 L315 | worktree: branch `fix/0777-...` in synthetic checkout | channels::`ch3 worktree` | key `777` |
| R25-4 L325 | protocol declaration | channels::`ch4 protocol` | `protocol`/`ch4-key` |
| R25-5 L335 | malformed channel 1 (`has a space`): unattributed, channel named, valid env key never leaks (= MUT2) | channels::`malformed ch1 does not fall through` x2 | `invalid taskHandoffKey` |
| R25-6 L349 | (i) `spec/0208-usage-attribution` + `specs/0208-*.md` related-issue 1171 | channels::`spec file maps to related issue` | `1171`, never `208` |
| R25-7 L374 | (ii) spec file absent: ch3 yields nothing, falls to ch4 | channels::`no spec file falls to ch4` | |
| R25-8 L385 | (iii) cwd in subdir `a/b`, `declaration.js set` resolves (explicit); after `clear`, ch3 derives 900 + forge-issue asset (= MUT4) | channels::`subdir walks up` x2 | `crewrig/crewrig#900` |
| R25-9 L405 | (iv) v2-F2: `feat/0203-probe-c-...` with spec file 1113; file removed 203 | channels::`pinned residue 203` x2 | `1113`, `203` |
| R25-10 L436 | (v) `fix/0054-delta01-md029` no spec | channels::`no spec file: 54` | `54` |
| R25-11 L445 | (vi) cwd `.worktrees/866` beats branch `feat/9999-...` | channels::`cwd worktree segment wins` | `866` (VERIFY `checkout.js` handles backslash) |
| R25-12 L455 | (vii) `fix/0866-...` + github ssh remote | channels::`forge-issue from ssh remote` | `crewrig/crewrig#866` |
| R25-13 L466 | (viii) host `git.example.internal`, `CREWRIG_FORGE_HOSTS=""`: key 900, no `externalAsset`, reason | channels::`unrecognized host` | `no recognized forge host` |
| R26-14 L475 | submit with `CREWRIG_TASK=capture-time-key`; ledger-append scope.session `ledger-time-key`; query `--session` gives ledger key; `--no-ledger` capture key; journal entry sha256 identical | ledger::4 tests | `ledger-time-key`, `capture-time-key` |
| R27-15 L521 | 7 fixtures, `--task-key attr-r27-task --rollup`: per-request netInput 300, run-total 500, session-cumulative 3000 (last snapshot only), uncapturedCount 1, no `mixed` without `--combined`; `--combined` mixed names per-request, run-total, session-cumulative (= MUT6) | ledger::`rollup sums` x6 | 300, 500, 3000, 1; `mixed` |
| R27-16 L576 | `capture-throw` with `CREWRIG_TASK=attr-r27-failure-task`: exactly one new entry (before/after diff excluding `.wing`/`.attr`), `capture threw`, kind uncaptured; `"attribution":{"taskHandoffKey":...}`; `.attr.json` channel env; rollup uncapturedCount 1 | ledger::`capture failure record` x4 (cwd `os.tmpdir()`, not `/tmp`) | `capture threw` |
| R28-17 L611 | declaration+submit+ledger under relocated root: no `.crewrig/usage` under (temp) HOME; declarations/ and ledger/ files >=1; rollup `--task-key r28-ledger-key` per-request netInput | ledger::`root override` x3 | the `.crewrig/usage` path |
| R29-18 L655 | claude-code, gemini-cli, subagent with `fix/0920-...`: `.attr.json` `attribution` identical across three and non-null; combined rollup netInput 666 = 111+222+333 | ledger::`cross-CLI identity` x2 | `666` |
| D01-19 L734 | `--period 2026-05 --rollup`: session-cumulative 500 (filter-first would be 1600), per-request 0, uncaptured 0 | period::`May rollup ledger-first` x2 | 500 |
| D01-20 L747 | `--period 2026-06 --rollup` | period::`June rollup` | 1500, 50, 1 |
| D01-21 L755 | `--period 2026-05 --cli claude-code` / `--fidelity session-cumulative` | period::2 tests | 500 |
| D01-22 L766 | plain `--period 2026-05` lists exactly 5 lines, all 2026-05 | period::`plain listing` | 5 |
| D01-23 L778 | `--task-key d01-task-a` 400; `d01-task-b` 1500 | period::2 tests | 400, 1500 |
| D01-24 L790 | composed: `--period 2026-05 --session d01-session-b`; `--period 2026-06 --task-key d01-task-a --no-ledger`; `... d01-task-a` 0 lines; `... d01-task-b` 4 June rows | period::`composed selectors` x4 | |
| D01-25 L825 | rollup under selection x6: `2026-05`+`d01-task-a` 400 (+`taskHandoffKey`); `--no-ledger` 0,0,0; June+`d01-task-b` 1500,50,1; May+`d01-task-b` 0,0,0; May+`d01-session-a` 500,0,0; session-b 0,0,0 (= MUT7) | period::`rollup under selection` x6 | |
| PRUNE-26 L867 | synthetic cli-period store `test-store` (scope cli-period, entry `/^test-entry-.*\.json$/`) registered (on lib COPY); `usage-prune.sh claude-code 2024-08 --force`: entry+`.attr.json` removed, `ledger/2024-08` empty, report `attribution-ledger: N>=1`, `test-store: 1`, partition rmdir'd | prune::4 tests on copied lib tree | `attribution-ledger:`, `test-store: 1` |
| PRUNE-27 L925 | no-store: entry removed; report names neither `attribution-ledger` nor `test-store` (R33) | prune::2 tests | |
| PRUNE-28 L947 | `layout.js` restored (`git diff --quiet`) | merged into the mutation-helper test | |
| STATIC-29 L954 | `child_process\|execSync\|spawnSync\|fetch\(\|https?://` has zero hits in `attribution.js`, `checkout.js`, `declaration.js` | mutations::`attribution libs are pure` (retarget if libs become `.ts`) | the regex |
| MUT1-MUT7 L969-1234 | see mutation set | mutations::one per mutant, red + restored | |
| 1260-A L1236, 1260-B | Bash trap regression | dropped, see below | `#1260` label |
| DOCS-39 L1327 | every `scripts/...` token in `docs/usage-attribution.md` exists | mutations::`docs paths exist` | `scripts/[A-Za-z0-9_./-]+`, trailing `.,)` and backtick stripped |

- **Changed or dropped assertions.** 1260-A and 1260-B (11 assertions) dropped: they execute/copy the Bash file itself and grep its `FATAL:` text; replaced by `#1260 mutation helper never touches tracked tree` (git diff clean after mutations; helper throws on missing marker). R28-17: the Bash `A && B && C || D` has an always-true `D` (rollup always prints `uncapturedCount`), so the file-count condition was vacuous; the port asserts declarations/ and ledger/ counts strictly (deliberate strengthening, log in the logbook). R26 duplicate `R26_ENTRY` placeholder not ported. PRUNE-28 folded into the helper test. Lines using `/tmp` use `os.tmpdir()`.
- **Mutation set.** On a temp copy of `scripts/lib/{usage-capture,usage-store}` (+ validator dir, schemas, symlinked `node_modules`), run via the copied `prune.js`/`query.js` CLI or driver: MUT1 `journal.js` `if (meta !== undefined) {` to `if (false && meta !== undefined) {`, no `.attr.json`, red on R29-18/R27-16 sidecar asserts; MUT2 `attribution.js` resolver continues after malformed candidate, red on R25-5; MUT3 `attribution.js` `specShape = null`, red on R25-9 (`1113`); MUT4 `checkout.js` `checkoutRootFor` without upward walk, red on R25-8 asset; MUT5a `prune.js` period arm `&& false`, red on PRUNE-26 ledger asserts; MUT5b cli-period arm disabled, red on `test-store: 1`; MUT6 `rollup.js` `'session-cumulative': lastSnapshots(captured)` to all snapshots (6000 vs 3000), red on R27-15; MUT7 `query.js` `admit: selectionPredicate(opts),` to fidelity-only, red on D01-25 (`2026-05`+`d01-task-a` regresses to 500). Each proven red against the original probe and the marker check normalises CRLF to LF.
- **Platform.** Windows-latest candidates: channels (VERIFY backslash handling in `checkout.js` for R25-11, else SKIP_WINDOWS with reason), ledger-rollup, period-rollup, prune, mutations (copy tree, junction for `node_modules`). POSIX-only: the single `bash scripts/usage-*.sh` shim smoke test. CI is `ubuntu-latest` only today.
- **Static reads and wiring.** `.github/workflows/usage-attribution.yml` L13, L28 (paths), L58 (`ci-cache-guard.sh --stray-scan -- bash ...`); `.gitlab-ci.yml` L3012, L3022, L3036; `ci/ci-capabilities.yml` L3848, L3863, L3874; `ci/shell-allowlist.txt` L217; sweep `grep -n "tests/test-usage" docs/usage-attribution.md docs/index.json docs/usage-*.md docs/cli-matrix.md docs/layers.md`. Add the new test files to every `paths:` filter. Taskfile has no reference.

#### Usage pricing and dashboard (pull requests D and E)

##### `scripts/tests/test-usage-dashboard.sh` (2922 lines)

- **Replacement suite.** All files drive the TS entries with `process.execPath` (never `bash`): `scripts/usage-dashboard.ts`, `usage-attribute.ts`, `usage-price.ts`, `usage-query.ts`, `usage-prune.ts`. Seeding of the golden root runs in a child `node` (lib JS reads `CREWRIG_USAGE_ROOT` per call; VERIFY in `layout.js` before any in-process use). Fixtures stay untouched (`scripts/tests/fixtures/usage-dashboard/{records,records-unconverted,records-controls,expected.json}` plus `usage-pricing/{pricelist,fx,records,org}` reused by path). Shared helpers (listed once, each under 300 lines, `usage-dashboard-views.ts` and `-render.ts` are the ported 560-line JS driver):

| replacement file | what it holds | est. lines |
|---|---|---|
| `scripts/tests/lib/usage-dashboard-rig.ts` | `REPO` (honours `USAGE_DASHBOARD_REPO`, default checkout), `seedGolden()`, `freshRoot()`, `dash()`, env builder (OFFLINE=1, CAPTURE_TEST=1, MIRROR=0, ROOT, `MEMPALACE_PALACE_PATH`; unset ROOT/WING/ALLOW_PRUNED), `manifest(root)` sha256 listing, `homeMarker()` + `classifyHomeDiff()` | 220 |
| `scripts/tests/lib/usage-dashboard-serve.ts` | `startServer` (parses `LISTENING http://127.0.0.1:<port>/` and `BOUND`, 15 s timeout), raw `http.request` (custom Host/headers/raw path), `holdPort`, token extraction, teardown by `POST /stop` then process-tree kill | 160 |
| `scripts/tests/lib/usage-dashboard-views.ts` | normalisers (`NORMALISE_VOLATILE/RECOMPUTED`), group algebra, ISO-week helpers, `extractEmbedded`, `partition()` | 280 |
| `scripts/tests/lib/usage-dashboard-render.ts` | `data-k` cell vs `format()` checker, price-statement checker, text-report parser, session drill-down block | 250 |
| `scripts/tests/lib/usage-dashboard-mutate.ts` | `mutateCopy(rel, regex, repl)` (copy `scripts/`, `schemas/`, optional `model-prices.org.json`, symlink `node_modules`; throws when the anchor changes nothing) and the M1..M15 table | 130 |
| `usage-dashboard-agreement.test.ts` | 13.1/13.2 five selections (whole, mixed, ranged, eur, xxx) + aot, 13.4 tallies, partition identity applied per view | 240 |
| `usage-dashboard-crosscheck.test.ts` | 13.3, 13.5, 13.8 | 220 |
| `usage-dashboard-buckets.test.ts` | 13.6, 13.7 (in-process `model.build` or bounded `Promise.all` spawns; check `check-timing-budget.test.ts` budget first) | 250 |
| `usage-dashboard-render.test.ts` | 13.9/13.10, 13.11, 13.18, 13.19, D6, i1-F1 | 290 |
| `usage-dashboard-page.test.ts` | 13.12, hardening (control chars, symlink) | 230 |
| `usage-dashboard-server.test.ts` | 13.13, 13.14, 13.15, 13.16 server half, #1371 child-handle check in teardown | 290 |
| `usage-dashboard-readonly.test.ts` | 13.16 offline guard with `fetch` stub (split out only if server file passes 300) | 100 |
| `usage-dashboard-static.test.ts` | 13.17 require closure, 13.13 single `.listen(` read | 90 |
| `usage-dashboard-mutations.test.ts` | 13.20 M1..M15: one `test()` per mutant, spawns `node --test <target file> --test-name-pattern` with `USAGE_DASHBOARD_REPO=<copy>`, expects non-zero exit; honours `USAGE_DASHBOARD_SKIP_MUTATIONS=1` | 200 |
| `usage-dashboard-home-marker.test.ts` | HOME marker classifier unit tests (spec 0216 delta-01 rules) + live before/after snapshot in `before()`/`after()` of the heaviest files | 100 |

- **Assertion mapping.**

| Bash case/group | behaviour asserted | replacement file::test intent | verbatim strings / exact values that MUST survive |
|---|---|---|---|
| 13.1 `case_agreement` | forms A (page JSON), B page, B `/view.json`, C `--json` deep-equal under the suite's normalisers, per selection whole/mixed/ranged/eur/xxx | agreement::one test per selection | schema `crewrig.usage-dashboard.view/1`; selections use `--task-key`, `--from/--to --model`, `--currency EUR`, `--currency XXX` |
| 13.1/13.2 cell and statement checks | every `data-k` cell equals `format(value)`; a `price-statement` span follows every `.price.amount`; C rows parse back, a `note:` line follows every price row | agreement::cells+statements per form | `data-k`, `price-statement`, `note:` |
| 13.1 normaliser export | `model.js` exports `NORMALISE_VOLATILE`/`NORMALISE_RECOMPUTED` equal to the suite's definition | agreement::exports match | export names |
| 13.1 USD stability / eur | two USD runs exact incl. `computedAt`; EUR `unconvertedCount` 0 | agreement::stability, ::eur | `unconvertedCount` 0 |
| 13.1 `[aot]` | `page --as-of-today`, `report --json --as-of-today`, B `POST /recompute` deep-equal (recomputed); cells and C rows as above | agreement::aot (3 forms) | `--as-of-today`, `/recompute` |
| 13.3 `case_0209` | totals.price maps onto usage-price `rollup()` per fidelity+combined (no `count` row, v2-F3), USD and XXX unconverted outside sums; `tasks[k].tokens` == `usage-query --task-key K --rollup --combined`; per-key passes | crosscheck::task-mixed and task-split-b | `task-split-a` 400, `task-split-b` 2400 |
| 13.4 `case_tallies` | gaps (`sess-gaps`): uncaptured 1, unpriced 1, sum 0.00045 in A/B/C; clean (`sess-alpha`) explicit zeros and zero `data-k` cells; no-priced model: amount null, absent `no-priced-record`, C em dash | agreement::gaps, ::clean, ::no priced record | `0.00045`, `no-priced-record`, em dash U+2014 |
| 13.4 partition (end of suite) | priced+unpriced+unconverted = captured and captured+uncaptured = records in every group of all views | applied inside every view-producing test via `partition()` (message kept) | message text in `ok` line |
| 13.5a/13.5b `case_unconverted` | EUR stored via `usage-price.ts --session --currency EUR`, FX removed: priced 1 / unconverted 1 / amount == stored EUR amount in A/B/C; four renderings agree; `store: false` reads leave manifest unchanged; `--currency XXX`: priced 0, unconverted >= 1, amount null, absent `no-converted-price` | crosscheck::unconverted, ::xxx | `no-converted-price`, `status ok` setup check |
| 13.6 `case_buckets` | sum day = week = month = byCli = byModel = totals per fidelity (1e-12), keys ascending; 2026-12-31 and 2027-01-01 in `2026-W53`; month keys; whole-store totals equal `expected.json` | buckets::4 tests | `2026-W53`, tolerance `1e-12` |
| 13.7 `case_placement` | every day/ISO week/month (`--period`, `--from/--to`)/model/CLI bucket equals the view filtered to it; inside `--from 2026-09-18 --to 2026-10-06` days equal unfiltered; S1: no `2026-09-20` day bucket, `2026-09-21` = 500 session-cumulative, `2026-W38` gets nothing, `--from 2026-09-20 --to 2026-09-20` zero + `superseded-only` (v2-F1) | buckets::placement, ::inside-range, ::S1 x3 | `superseded-only`, 500 |
| 13.8 `case_period_agreement` | `--period 2026-09/2026-10`: dashboard tokens/price/priced/unpriced == `usage-query --rollup` and `usage-price --rollup` (1e-12); R45 `--task-key task-split-a --period 2026-10`, `task-split-b` 2026-11 | crosscheck::period, ::R45 | keys/periods as listed |
| 13.9 / 13.10 | task rollup `mixed` = `["per-request","session-cumulative"]` on tokens, price; marker in A, B, C and the combined totals `<tr>` of A/B; `format.mixed()` names both; no-agent session keeps `agents: []`, parent lists `agent-reviewer`; text `No subordinate agent` | render::mixed, ::drilldown | `mixed`, `No subordinate agent`, `agent-reviewer` |
| 13.11 `case_empty` | empty states x4 forms: no-match, store-empty (pin-only root), pruned store with leftover empty `journal/<cli>/<YYYY-MM>` dirs via `usage-prune.ts --force` = store-empty (v2-F2, 13.11b), superseded-only (`--from/--to 2026-09-20`, `--session` variant, 13.11c); C exits 0, B 200, banners distinct, snapshot count text, never `No record matches` | render::empty x5 + distinct-banners | `store-empty`, `superseded-only`, `No record matches` |
| 13.12 `case_static_page` | default path `<root>/dashboard/usage-dashboard.html`, path printed; one `<script`/`</script`, `type="application/json"`; no `<!--`; none of `<link`, `src=`, `href=`, `srcset=`, `action=`, `poster=`, `url(`, `@import`, `fetch(`, `XMLHttpRequest`, `import(` outside JSON; CSP `default-src 'none'`; literal `</script`; hostile agentId/asset ref round-trip; no raw U+2028/9; footer generatedAt, `--as-of-today`, `task usage:dashboard`; mode 600 in 700 dir, also umask 000 | page::12 tests | all quoted strings, `600`, `700`, `umask 000` |
| 13.13 `case_bind` | `BOUND 127.0.0.1`; non-internal IPv4 connect refused; `serve --host\|--bind\|--address 0.0.0.0` exit 2; `HOST=0.0.0.0` env ignored; one `.listen(` with literal `'127.0.0.1'` in `server.js` | server::bind, static::listen | `BOUND 127.0.0.1`, exit 2 |
| 13.14 `case_port_conflict` | `serve --port <taken>` exit 3, names port, `in use`, no LISTENING fallback, listener still owns port | server::port-conflict | exit 3, `in use` |
| 13.15 `case_security` | Host `evil.example` 421, `127.0.0.1:<port>`/`localhost:<port>` 200; per-process token in page; POST `/recompute` and `/stop` without/wrong token, foreign Origin, `Sec-Fetch-Site: cross-site` 403; GET `/recompute` 404 or 405, PUT 405, traversal 404, `/journal/` 404, 20 KB body 413; no `Access-Control-*`; CSP (`default-src none`, `frame-ancestors none`), `no-store`, `nosniff`, `no-referrer`, `DENY`, CORP `same-origin` | server::security x6 | status codes above |
| 13.16 `case_readonly` | `POST /recompute` computedAt later than every stored one; page cites `task usage:price -- ... --as-of-today`; manifest unchanged across GET `/`, `/view.json`, POST; record written between two GETs counted (n+1, R15); `POST /stop` with token exit 0; no `dashboard/` dir from B; offline guard: `CREWRIG_USAGE_OFFLINE` unset, `fetch` stubbed, 0 calls, `PRICED>0`, fxStaleness reads `offline`, manifest unchanged | server::readonly, readonly::offline-guard | `offline`, ISO string compare |
| 13.17 `case_no_daemon` | require closure of `lib/usage-dashboard/*.js` never reaches `usage-store/mcp.js` or `mirror.js`, does reach `query.js` and `usage-price/store.js` | static::closure x2 | module names |
| 13.18 `case_no_conversation_text` | `SENTINEL-CONVERSATION-TEXT`, `SENTINEL-PROJECT-ROOT`, `transcriptExcerpt`, `uncapturedReason`, `rawStatus` absent from A/B/C (whole + gaps) | render::no-leaks | the five sentinels |
| 13.19 `case_text_stable` | two runs identical minus `Generated`; no ESC; column order; section order Selection, Pricing, Totals, By `<bucket>`, By CLI, By model, Sessions, Tasks, Assets | render::text-stable x4 | section names |
| D6 `case_arguments` | `report` with `--undrained`, `--pending`, `--rollup`, `--combined`, `--period 2026-9`, `--bucket year`, `--from > --to`, `--agent a` (no `--parent`) each exit 2 with `FATAL` | render::arguments (8 cases) | exit 2, `FATAL` |
| i1-F1 `case_session_subtree` | `--session sess-parent`: sessions[X] agents/tokens/prices/tallies equal unfiltered in A/C/B/Bv; drill-down lists `agent-reviewer`, never `No subordinate agent`; cells equal `format()` | render::session-subtree | `sess-parent` |
| hardening `case_control_chars` | `--json` has no raw DEL/C1/U+2028/9, has `\u007f \u0080 \u0085 \u009f` escapes, ids round-trip; HTML maps C0 (not tab/LF), DEL, C1 to U+FFFD, keeps tab; `page --out` onto symlink replaces link, mode 600, victim untouched | page::controls x2, ::symlink | U+FFFD, escapes above |
| 13.20 M1..M15 | each mutant turns its case red; anchor mismatch FAILs loudly | mutations::15 tests | see Mutation set |
| HOME marker | `$HOME/.crewrig/usage` unchanged, spec 0216 delta-01 classification | home-marker::classifier + live | message `$HOME/.crewrig/usage is unchanged by the suite` |
| #1371 orphan check | no `driver.js hold-port` process outlives the run | server::teardown asserts child exited | message `no driver.js hold-port process outlives this run` (reworded to the child handle) |

- **Changed or dropped assertions.** The `pgrep -fl` orphan check becomes a child-handle assertion (`exitCode`/`killed` after teardown), since there is no driver.js process any more; same regression (#1371), stronger. The preflight `scripts/usage-dashboard.sh` existence check is dropped (shims are not deleted; shim forwarding is already in `usage-wrappers.test.ts`). 13.13 FAILs (not skips) when no non-internal IPv4 exists in the Bash suite; VERIFY with the spec whether to keep FAIL or skip in CI sandboxes (inventory suggests skip). 13.15 traversal: Bash `path: u.pathname` was normalised by `URL` so it may never have sent `/../..`; the replacement sends a raw `/../../etc/passwd` (strengthening, expect 404).
- **Mutation set.** Applied to a temp copy (never tracked files). Dir `D=scripts/lib/usage-dashboard`. All anchors are perl `-0` regexes: port to JS with `[\s\S]` for `.`-across-newline, and assert the replacement changed the text.

| id | file | edit | red assertion |
|---|---|---|---|
| M1 | `D/text.js` | Totals row prints recordCount+1 (`out.push(line(cellTexts[i]))` replaced) | agreement (13.1 C rows parse back) |
| M2 | `D/model.js` | `entry.unpricedCount += 1;` becomes `entry.pricedCount += 1;` | tallies (13.4) |
| M3 | `D/html.js` | add `<link rel="stylesheet" href="https://cdn.example/x.css">` after `<meta charset="utf-8">` | page (13.12 no-external) |
| M4 | `D/server.js` | `listen(..'127.0.0.1'` becomes `'0.0.0.0'` | bind (13.13) |
| M5 | `D/server.js` | `if (!allowedHosts().includes(host))` becomes `if (false)` | security (13.15 Host 421) |
| M6 | `D/model.js` | `store: false,` becomes `store: true,` | readonly (13.16 manifest) |
| M7 | `D/html.js` | `embedJson` stops escaping `<` (lazy `[\s\S]*?`) | page (13.12 `</script`) |
| M8 | `D/model.js` | remove `process.env.CREWRIG_USAGE_OFFLINE = '1';` | readonly offline guard |
| M9 | `D/model.js` | `unconvertedCount += 1;` also `sum += p.amount;` | unconverted (13.5a) |
| M10 | `D/html.js` | combined `<td>` drops the mixed text (`/mixed$/.test(c.k)`) | mixed (13.9) |
| M11 | `D/text.js` | drop the `if (r.statement) out.push(...)` note line | agreement (13.2 `note:`) |
| M12 | `D/model.js` | `contributingRecords(records)` becomes `contributingRecords(records.filter(place))` | placement (13.7) |
| M13 | `scripts/lib/usage-store/query.js` | `&& touched.size === 0) break;` becomes `) break;` (readWindow lookahead, shared with 0209; re-check anchor) | placement (13.7) |
| M14 | `D/html.js` | delete the `.replace(/[\u0000...` control-char line in `esc()` | page controls (hardening) |
| M15 | `D/source.js` | `const subordinates = sel.session ? readSubordinates(...)` becomes `const subordinates = [];` | session-subtree (i1-F1) |

- **Platform.** windows-latest: agreement, crosscheck, buckets, render, static, server (loopback only; IPv4 probe skipped when no non-internal interface), readonly, home-marker classifier, mutations. POSIX-only (`SKIP_POSIX`): the mode 600/700 and umask 000 tests and the symlink test in `usage-dashboard-page.test.ts` (Windows modes are 0o666, symlink needs privilege). Process-group kill on teardown is POSIX (`detached` + `kill(-pid)`), Windows uses `taskkill /T /F`; `POST /stop` is the primary teardown on both. VERIFY: `usage-wrapper.ts runJs` spawns a grandchild, so killing the entry may orphan the listener (same class as #1371).
- **Static reads and wiring.** Must change on deletion: `.github/workflows/usage-dashboard.yml` (path filters lines 10 and 33 `scripts/tests/test-usage-dashboard*.sh`; run step line 74 `bash scripts/ci-cache-guard.sh --stray-scan -- bash scripts/tests/test-usage-dashboard.sh`), `.gitlab-ci.yml` (lines 3094, 3101, 3123), `ci/ci-capabilities.yml` (lines 3966, 3989, 4011), `ci/shell-allowlist.txt:219`. VERIFY: the stray-scan guard accepts a `node --test` command and `check-ci-parity` expectations for the usage-dashboard job; no `test-check-ci-parity.sh` line names the dashboard suite. Update `specs/` prose only if the spec says so.

##### `scripts/tests/test-usage-pricing.sh` (2568 lines)

- **Replacement suite.** Copies of `scripts/lib/usage-price`, `scripts/lib/usage-store` (+ `usage-wrapper.ts` and the `usage-*.ts` entries; VERIFY copy size) into a per-file temp checkout; mutants are applied to the copy via `String.replace` after asserting `src.includes(needle)` (a missing needle FAILs, never skips). The 13-subcommand node driver heredoc (pin, seed-fx, write, compute-price, resolve-and-compute, price-record, resolve, fx-resolve, rollup, plant-price, rollup-fetch-count) is ported to a CJS-requiring helper run in a child `node` per call (CJS require cache must not leak across cases; `period-of` is unused and dropped). Fixtures `scripts/tests/fixtures/usage-pricing/{pricelist,fx,org,records}` stay.

| replacement file | what it holds | est. lines |
|---|---|---|
| `scripts/tests/lib/usage-pricing-rig.ts` | `makeCheckout()`, `mutate(co, rel, needle, repl)`, `caseRoot()` (env: OFFLINE=1, CAPTURE_TEST=1, MIRROR=0, palace path with no token file; unset WING/ALLOW_PRUNED/PRICE_ORG_FILE/PRICE_CURRENCY/PRICE_AS_OF_TODAY/FX_INJECT_SEED_FILE; env built from scratch plus PATH/SystemRoot/TEMP), `driver()`, `makeRecord()` (recordId = sha256(sessionId + U+001F + idempotencyKey)), `approx(a,b,1e-12)`, `entry()`, HOME marker snapshot | 190 |
| `scripts/tests/lib/usage-pricing-driver.js` | the ported driver subcommands | 190 |
| `usage-pricing-compute.test.ts` | Cases 1-5, ladder L, R38 | 240 |
| `usage-pricing-fx.test.ts` | Cases 6-10 | 200 |
| `usage-pricing-rollup.test.ts` | Cases 11/12, 13, 16, 17, 18, 19 task-key | 260 |
| `usage-pricing-prune.test.ts` | Cases 14a-c, 15 | 200 |
| `usage-pricing-conversion.test.ts` | delta-02 19a-19h + M19-1..5 (one `describe`, sequential, stateful; split `-a`/`-b` if over 300) | 290 |
| `usage-pricing-static.test.ts` | structural group S, HOME check, preflight | 90 |

- **Assertion mapping.**

| Bash case/group | behaviour asserted | replacement file::test intent | verbatim strings / exact values that MUST survive |
|---|---|---|---|
| Case 1 (R13) | `gemini-3.8-pro` resolves by family fallback to `gemini-3.8-flash`, `family:true`; M red | compute::family fallback | `gemini-3.8-pro`, `gemini-3.8-flash` |
| Case 2 (R14/R39) | 1h cache write prices at `cache_creation_input_token_cost_above_1hr`, `amountUsd` 0.0075 | compute::1hr tier | `0.0075` |
| Case 3 (R14/R18) | 250000 netInput + 1hr write: compound `cache_creation_input_token_cost_above_1hr_above_200k_tokens`, netInput `input_cost_per_token_above_200k_tokens` | compute::compound threshold | both field names |
| Case 4 (R16/R39) | equal rate: `unpricedComponents []`, `amountUsd` 0.000045 (exact `0.000044999999999999996`); divergent: `['reasoning-rate-divergence']`, 0.0002 (exact `0.00019999999999999998`) | compute::reasoning x2 | exact doubles, strict equality (no approx) |
| Case 5 | `_above_200k` rate applies to whole 250000-token request, netInput `amountUsd` 1.5 | compute::long-context whole | `1.5` |
| Case 6 | fixing = latest on or before date (2026-09-19 gives 2026-09-18, never 2026-09-21) | fx::direction | `2026-09-18` |
| Case 7 (R22/R29) | gate fires, injected fetcher called once, resolves 2026-09-21, no `fxStaleness`; OFFLINE deleted in child env only | fx::freshness gate | `2026-09-21` |
| Case 8 (R22/R41) | OFFLINE suppresses refresh; `fxStaleness {ageDays:3, reason:'offline'}`, 0 fetches | fx::offline staleness | `ageDays` 3, `offline` |
| Case 9 (R27/R41) | EUR price carries `snapshot.sha`, `fixingDate`, `computedAt` | fx::timestamps | key names |
| Case 10 (R28) | `--as-of-today` re-resolves `computedAt` (1.1 s apart, real wait) | fx::as-of-today | second computedAt differs |
| Case 11 (R32) | session-cumulative bucket count 1 not 2 | rollup::one snapshot | count 1 |
| Case 12 (R33) | combined `mixed` == `['per-request','session-cumulative']` | rollup::mixed marker | exact array |
| Case 13 (R34) | unpriced tallied apart: count 2, `unpricedCount` 1, not zero-cost | rollup::unpriced | counts |
| Case 14 | real two-store registry: after `usage-attribute.ts add` + `usage-prune.ts --force`, price partition and ledger period dir rmdir'd, pruned marker exists, report names `attribution-ledger: N` and `price-store: N`, N>=1 (assert "store" is named, then each with N>=1); 14a/14b/14c mutants | prune::registry end-to-end + 3 mutants | `attribution-ledger`, `price-store` |
| Case 15 | nothing registered holds data: no store named, `1 record(s) removed`; M15 names stores with `: 0` | prune::no registered store | `1 record(s) removed` |
| Case 16 (R34, #1194) | `usage-price.ts --period --cli` over captured + uncaptured: rc 0, 2 JSONL lines; captured numeric >0; uncaptured line `uncaptured:true`, `kind`, `amount:null`, `amountUsd:null`, `resolution.step 'uncaptured'`, no `unpriced` key; no price file under `prices/**` for it; `--rollup` unchanged, `uncapturedCount` 1, `unpricedCount` 0; M asserts rc!=0 and stderr contains `toLowerCase` | rollup::uncaptured | `uncaptured`, `toLowerCase` |
| Case 17 (delta-01 R43-R48) | straddling session placed in LAST snapshot period: 05 sum 0.0015 count 1; 06 sum 0.0027; priced/unpriced 1\|0\|1\|0; `--session` A 0.0015, B 0.0027; R46 0.0042; R47 dashboard + `usage-query.ts` agree (tokens 500/900); M filter-first gives 0.0036; after `usage-prune.ts claude-code 2026-06 --force`: 05 sum 0.0036 count 2 priced 2, dashboard 1200 tokens | rollup::straddle x6, ::prune survival | `0.0015`, `0.0027`, `0.0042`, `0.0036`, `1200` |
| Case 18 (R44) | superseded 2026-05 snapshot contributes count 0 priced 0 unpriced 0 sum 0; 2026-06 count 1 unpriced 1 priced 0; dashboard agrees | rollup::superseded x4 | counts |
| Case 19 (task-key, #1205) | `--period X --task-key c19-task --rollup`: 05 = 0.0009 (K2 300), 06 = 0.0012 (K1 400), count=priced=1; dashboard + query agree. Rename the TS test `task-key` (Bash reuses label "Case 19") | rollup::task-key | `c19-task`, `0.0009`, `0.0012` |
| Ladder L | `Gemini 3.8 Flash (Medium)` exact `gemini-3.8-flash`; `gpt-5-copilot` family onto `gpt-5`; M-A `REWRITE_GENERATORS` empty; M-B drops `EFFORT_PAREN_RE` leading `\s*` and slug hyphen trim | compute::ladder x2 + 2 mutants | names above, step `exact` |
| S (R5, R35) | no `journalEntry(` or `wingSidecar(` under `usage-price/`; `openrouter.ai` only in `crosscheck.js`, one `require(.*crosscheck`; no `fetch(`/`https?://` in resolve/compute/store/rollup; no `fetch(` in `layout.js`/`prune.js` | static::5 tests (fs read + regex) | `openrouter.ai`, `crosscheck.js` |
| R38 | exact; alias resolves to `claude-sonnet-4-6`; R4 `sourceUrl` absent for exact, LiteLLM URL for alias; M drops `if (sourceUrl) resolution.sourceUrl = sourceUrl;`; org override `org-exact` rate 0.000001; org-added step; unresolvable `unpriced`; R20/R21 `legacy-plan-reference-price` | compute::R38 x8 | `legacy-plan-reference-price`, `claude-sonnet-4-6`, `0.000001` |
| 19a-19h (R47, R51-R54, R56) | 19a status `no-fixing-on-or-before`, requested EUR, fixingDate null, amount labelled USD; 19b rollup tallies (per-request 3 = 1+1+1, sc 1, run-total `unconvertedCount` 0, combined unconverted 2 unpriced 1 uncaptured 1, partition, s1b labelled USD); 19c dashboard agrees, fixing null both; 19d converted (ECB, 2026-09-21, amount = usd/1.149); 19e JPY `no-such-currency`, fixingDate `2026-09-21`, counts 2/1/3, dashboard agrees; 19f USD over stored failures (priced 3, unpriced 1, unconverted 0, no `requested`, sums 0.009 and 0.0012); 19g pre-delta EUR label healed; 19h `FETCHER_CALLS` 1\|1 and all 3 unconverted both passes | conversion::one test per sub-case, sequential | status strings, `1.149`, `0.009`, `0.0012` |
| M19-1..M19-5 | see Mutation set | conversion::mutants | |
| REGRESSION 1260-A/B | dirty-tree FATAL and EXIT-trap restore of the Bash mutation harness | dropped | see below |
| HOME safety (0216) | `$HOME/.crewrig/usage` unchanged, pending to mirrored excused, new sha256-named files offend | static::home marker (before/after in the rig) | `$HOME/.crewrig/usage` |

- **Changed or dropped assertions.** Dropped: REGRESSION 1260-A and 1260-B (11 asserts) test the Bash dirty-tree guard and EXIT trap; mutants no longer touch tracked files, so the hazard cannot exist. Dropped: every "X is restored after Case N" assert (about 16): same reason (nothing is edited in place). Strengthening: each mutant additionally asserts the needle was found; a stale needle FAILs. Kept as red-oracle: all "MUTATION RED" asserts (about 27). Target: at least 108 of about 125 assertions; state the 27 dropped in the PR.
- **Mutation set.** Edits on the temp checkout copy. Target dir `P=scripts/lib/usage-price`, `S=scripts/lib/usage-store`.

| id | file | needle replaced by | red assertion |
|---|---|---|---|
| C1 | `P/resolve.js` | `family: followed.step === 'family',` becomes `family: false,` | Case 1 |
| C2 | `P/compute.js` | `cacheWriteBaseField(tierKey)` returns base `cache_creation_input_token_cost` | Case 2 |
| C3 | `P/compute.js` | `siblingField(baseField, threshold)` built from the base field name | Case 3 |
| C4 | `P/compute.js` | reasoning-divergence branch adds `reasoning * reasoningRate` | Case 4 |
| C5 | `P/compute.js` | `if (netInput > 0) {` branch prices only `(netInput - threshold) * rate` (gives 0.3) | Case 5 |
| C6 | `P/fx.js` | `selectFixing` returns next fixing (`d >= date`) | Case 6 |
| C7 | `P/fx.js` | `const gateFires = !newest \|\| newest < date;` becomes `!newest` | Case 7 |
| C8 | `P/fx.js` | `if (staleReason) {` becomes `if (false && staleReason) {` | Case 8 |
| C9 | `P/store.js` | drop `computedAt` from the `fixingDate: null, resolution` literal | Case 9 |
| C10 | `P/store.js` | `if (!asOfToday && fs.existsSync(filePath)) {` becomes `if (fs.existsSync(filePath)) {` | Case 10 |
| C11 | `S/rollup.js` | `'session-cumulative': lastSnapshots(captured),` replaced to sum all snapshots | Case 11 |
| C12 | `P/rollup.js` | `result.combined = { sum, unpricedCount, unconvertedCount, mixed };` drops `mixed` | Case 12 |
| C13 | `P/rollup.js` | `if (cls === 'unpriced') {` becomes `false && ...` | Case 13 |
| 14a/14b/14c | `S/prune.js` | `for (const store of layout.derivedStores()) {` becomes `for (const store of []) {`; skip `store.scope === 'period'` arm; skip `'cli-period'` arm | Case 14 |
| 15 | `S/prune.js` | `let storeNames;` block names empty stores with `: 0` | Case 15 |
| C16 | `P/store.js` | `if (record.kind !== 'captured') return uncapturedMarker(record, currency);` removed | Case 16 (rc!=0, stderr `toLowerCase`) |
| C17 | `S/query.js` | `if (!opts.period \|\| opts.undrained \|\| opts.pending) return` becomes `return` | Case 17 (0.0036) |
| LA/LB | `P/resolve.js` | `const REWRITE_GENERATORS = [genLower, genSlug, genVsep, genEffort, genChan, genDated];` becomes `[]`; EFFORT_PAREN_RE leading `\s*` and `.replace(/^-+\|-+$/g, '')` removed (build needle with `String.raw`) | ladder |
| R4 | `P/store.js` | `if (sourceUrl) resolution.sourceUrl = sourceUrl;` removed | R38 |
| M19-1 | `P/store.js` | `if (converted.conversion.status === 'ok') {` becomes `if (true) {` | 19a |
| M19-2 | `P/fx.js` | no-such-currency branch drops `fixingDate` | 19e |
| M19-3 | `P/store.js` | R52 status guard removed | 19f(1), 19f(2), 19f(3), 19g (4 red checks) |
| M19-4 | `P/rollup.js` | `unconvertedCount += 1;` (eight leading spaces) also adds the unconverted amount | 19b |
| M19-5 | `P/fx.js` | `if (!(ctx.fxMemo instanceof Map)) return resolveOnce(date, ctx);` made unconditional | 19h (3\|3) |

- **Platform.** All files spawn only `node`, so none needs bash. Run on windows-latest: static, compute, fx. Gate entry-spawning files (rollup, prune, conversion) with `SKIP_POSIX` until the Windows leg is confirmed, then drop the skip (VERIFY on windows-latest). Mutation copies avoid git, so no platform-specific path. Periods derived from `new Date()` must use UTC getters (midnight on the 1st is a latent flake in the original; prefer fixed dates).
- **Static reads and wiring.** Must change on deletion: `.github/workflows/usage-pricing.yml` (paths lines 10 and 31; run step line 70), `.gitlab-ci.yml` lines 3047, 3054, 3074, `ci/ci-capabilities.yml` lines 3907, 3928, 3948, `ci/shell-allowlist.txt:220`, and `scripts/tests/test-check-ci-parity.sh` lines 581, 605, 611 (uses `test-usage-pricing` as the bare-scanned example and mutates that workflow step: re-point to another still-Bash scanned suite or rewrite SC1/SC2/PF4 for the `node --test` step; expected text `unexpected step: 'bash scripts/tests/test-usage-pricing.sh'` changes). VERIFY that `ci-cache-guard.sh --stray-scan --` accepts a node command. Prose in `specs/0218` and `0253` names the suite; update only if the spec requires.

### Decision record

#### Pull request grouping

Five pull requests, so that each stays reviewable (about 1.5 to 5 thousand removed Bash
lines) and so that the long CI jobs of different workflows overlap. Pull requests B to E
are independent of one another and of A except for the shared mutation helper of A; they
open from the same release tip, in parallel worktrees, and merge one at a time at the
coordinator's request.

| PR | Branch | Suites | Bash lines removed | CI workflows touched |
|---|---|---|---:|---|
| A | `test/1340-hooks-and-capture` | `test-usage-record-schema`, `test-worktree-git-guard`, `test-mempalace-transcript-hook`, `test-palace-path-propagation` (retired), `test-usage-capture`; shared helper `scripts/tests/lib/mutation-copy.ts` | about 1.6 k | `usage-record-schema.yml`, `usage-capture.yml`, `build.yml` |
| B | `test/1340-worktree-sync` | `test-worktree-claim`, `test-sync-from-upstream` | about 4.9 k | `build.yml` |
| C | `test/1340-usage-store-attribution` | `test-usage-storage`, `test-usage-attribution` | about 3.1 k | `usage-storage.yml`, `usage-attribution.yml` |
| D | `test/1340-usage-mirror-pricing` | `test-usage-storage-mirror`, `test-usage-pricing` | about 4.4 k | `usage-storage.yml`, `usage-pricing.yml` |
| E | `chore/1340-usage-dashboard` | `test-usage-dashboard`; flips this spec and its deltas to `implemented`; documentation sweep | about 2.9 k | `usage-dashboard.yml` |

A is first because it is small, it carries the shared helper, and it settles the shape of
the CI rewiring that B to E repeat. C and D both touch `usage-storage.yml`; D rebases on
C if C merges first. Because `ci/ci-capabilities.yml` and the files generated from it are
shared by every row of the wave, each pull request regenerates them from the current
release tip just before its merge request, never merges hunks.

#### Rejected alternatives

- **One pull request per suite (twelve).** Rejected: the CI restart after each merge into
  the release branch costs 25 to 35 minutes per queued pull request, and the seat passes
  multiply.
- **One pull request for the whole row.** Rejected: about 17 thousand removed lines and
  about 12 suites in one diff cannot be reviewed against the mapping.
- **Port assertions one for one into a single driver per suite.** Rejected: the files
  would exceed the 300-line bound that the Windows proof requires, and one Bash suite's
  state carried from case to case (the usage suites) would stay hidden. Each replacement
  test builds its own fixture.
- **Keep the in-place mutations (`git checkout` restore).** Rejected: `node --test` runs
  files in parallel, so a tracked file that is mutated for one test is read by another.
  A mutated temporary copy has no such race, and the dirty-tree guard and the
  `EXIT`-trap regression cases retire with the mechanism that needed them.
- **Retire `test-mempalace-transcript-hook.sh` without a port.** Rejected: the TypeScript
  suites of spec 0247 cover its behaviours, but none runs the shim and a stub daemon
  end to end, which is the leg that the Bash suite owned.
- **Move `test-setup-*transcript` and `test-setup-usage-capture-optin` into this row.**
  Rejected: they exercise the setup entry points of row F1, J1b owns `test-setup-*`, and
  two rows editing the same suite is the collision that the strict boundary prevents.

#### Order inside a pull request

For each suite: the replacement lands with its mapping; the mutation proof runs against
the Bash suite at the base commit and against the replacement; the Bash suite is deleted
in the same pull request, with its allowlist line, CI wiring and static reads.

## Scenarios

**Scenario:** A broken usage command turns the new suite red

Given the replacement of `test-usage-storage.sh` and a temporary copy of
`scripts/lib/usage-store/` in which the journal append no longer takes its lock
When the replacement suite runs against the mutated copy
Then at least the test that the Bash suite named for lock contention fails, and the
unmutated copy passes the whole suite.

**Scenario:** A suite that ran under Bash now runs on Windows

Given `windows-latest` with Node.js 24 and no POSIX layer on the path
When the Windows job of the usage-capture hook runs the replacement files that need no
`bash`
Then they pass, and the files that need `bash` report a skip that names `win32`.

**Scenario:** The retired library test leaves nothing uncovered

Given the deletion of `test-palace-path-propagation.sh`
When each of its fifteen assertions is looked up in the mapping
Then every one names a consumer-level test that exists on the release branch, and the
assertions on the launcher's configured palace path are checked by
`service-launcher-palace-path.test.ts`.

**Scenario:** A missing toolchain fails in CI

Given a CI runner where `ssh-keygen -Y sign` is unavailable and the variable `CI` is set
When the signing file of `sync-from-upstream` runs
Then the test fails with a message naming the missing capability instead of skipping.

**Scenario:** A mutation helper cannot find its needle

Given a mutation case whose search text no longer occurs in the copied implementation
When the case runs
Then it fails, naming the file and the text, instead of passing against an unmutated copy.

**Scenario:** A deleted suite leaves the repository consistent

Given a pull request that replaces a Bash suite
When `check-test-wiring`, `check-test-strays`, the shell ratchet and the CI generator run
Then they pass, `ci/shell-allowlist.txt` no longer lists the suite and no workflow, document
or allowlist of this row names it.

**Scenario:** A defect is found while porting

Given a replacement test that exposes a behaviour of a script that looks wrong
When the developer reaches that test
Then the behaviour is reported to the coordinator, the test asserts the current behaviour
with a comment naming the report, and the script is unchanged.

## Out of scope

- The Bash tests of rows J1b, J2 and J3 listed in requirement 2, and any edit to them.
- Retiring `scripts/lib/common.sh`, `usage-headless.sh` and the other shell libraries,
  and the final shim removal (rows J4 and J3).
- Changing the behaviour of a script, a hook, a fixture format or a diagnostic line.
- The Windows timing-budget flake of #1509, #1614, #1599, #1545, #1601, I2 (#1339) and J2
  (#1343).
- A change to `package-lock.json`: the F1 setup goldens embed its hash.
- Any new dependency.
- Measuring latency budgets: the budgets of the hooks belong to rows C1 to C3.

## Open questions

- **`scripts/tests/test-check-ci-parity.sh` (row J2) reads the real `usage-pricing`
  capability.** Its cases SC1 and SC2 select the job `usage-pricing`, a step whose text
  matches `test-usage-pricing`, and the declared scanned command, as the example of a bare
  stray-scanned step. Replacing the pricing suite changes that step. The retarget (another
  bare scanned capability, or a fixture built in the suite) belongs to J2's file; the
  coordinator decides whether J1a edits those lines in pull request D or J2 does after it.
- **Stale source comments.** `scripts/lib/usage-capture/{record,sink}.js`,
  `scripts/lib/usage-store/mcp.js` and `scripts/worktree-claim.sh` name deleted suites in
  comments. A comment-only edit leaves behaviour frozen; the coordinator confirms that
  this row may make it.
- **`scripts/tests/lib/usage-capture-derive.js` and the usage-storage fake daemon
  `fixtures/usage-storage/fake-mempalace-mcp.js`** are tracked JavaScript files of the
  ratchet baseline. Porting them to TypeScript shrinks the baseline; the PLAN decides per
  file, and the ratchet only permits shrinking.
- **Per-suite VERIFY items** carried in the *Suite sections* are resolved in the PLAN
  before the first pull request opens.

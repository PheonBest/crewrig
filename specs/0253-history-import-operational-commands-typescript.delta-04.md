---
id: "0253"
slug: history-import-operational-commands-typescript
status: draft
complexity: small
interaction-mode: MINIMAL
related-issue: 1515
version: 2.3.0
---

# History import and operational commands in TypeScript

*Delta 04 of `specs/0253-history-import-operational-commands-typescript.md`,
cumulative over delta-01, delta-02 and delta-03
(`specs/0253-history-import-operational-commands-typescript.delta-01.md` to
`.delta-03.md`): every Original quoted below is the current text, that is the
parent as modified by delta-01, delta-02 then delta-03. Source: issue
[#1515](https://github.com/crewrig/crewrig/issues/1515), which tracks the parity
gap that delta-01 requirement 23 recorded. It runs under the release-branch
regime of `specs/0215-shell-to-typescript-migration.delta-04.md`: its spec-PR
targets `release/1231-ts-migration`, and the base ref of every protocol is
`origin/release/1231-ts-migration`. The implementation pull request realises the
parent plus delta-01 to delta-03 and this delta (`docs/spec-pr-workflow.md`,
*Delta-spec cumulative rule*). Every requirement number is unchanged.*

*Version: MINOR, 2.2.0 to 2.3.0 (`docs/spec-format.md`, *Versioning*). The delta
closes a recorded parity gap by adding a behaviour to the write path of the usage
mirror and withdraws the statement that the gap is left unfixed; no existing
passing behaviour on POSIX changes, hence an additive normative change.*

*Finding. `onWrite` in `scripts/lib/usage-store/mirror.js` ends with
`spawn('bash', [scriptPath, '--from-write'], { detached: true, stdio: 'ignore' })`
followed by `child.unref()`, where `scriptPath` is `scripts/usage-mirror.sh`.
Windows has no `bash`, and the spawn has no `error` listener, so a failed spawn
is a candidate for an unhandled `error` event on the journal write path. Since
spec 0253 the target already exists as TypeScript: `scripts/usage-mirror.ts`
accepts `--from-write`. The `.sh` file is only a forwarding shim, so the spawn can
name the TypeScript entry through `process.execPath` and need no `bash` at all.*

## ADDED

**Scenario:** A write with a token file spawns the TypeScript mirror entry without
`bash`

Given a scratch `HOME` (`USERPROFILE` on Windows), `CREWRIG_USAGE_ROOT` pointing
at a temporary directory, a token file present, a `PATH` that holds no `bash`, and
a preload stub (`NODE_OPTIONS=--require <stub>`) that records the arguments of
every spawn and replaces the target so that nothing real runs
When a usage record is written through the journal write path
Then the write returns `stored` and exits 0, exactly one pending marker exists,
and the recorded spawn is `[process.execPath, <abs>/scripts/usage-mirror.ts,
--from-write]`, spawned with no shell.

**Scenario:** A failed spawn never changes the outcome of the write

Given the setup above, with `process.execPath` made unspawnable in the child under
test
When a usage record is written
Then the write exits 0 with its record stored, the pending marker exists, nothing
is written to standard error, and no unhandled `error` event is raised.

**Scenario:** The gates are unchanged and no spawn happens behind a closed gate

Given the setup above
When there is no token file
Then no spawn is recorded and no `mirror` directory exists under
`CREWRIG_USAGE_ROOT`.
When `CREWRIG_USAGE_MIRROR` is `0`
Then the marker is written and no spawn is recorded.
When an unreachable stamp younger than `CREWRIG_USAGE_MIRROR_BACKOFF_MS` exists
Then the marker is written and no spawn is recorded.

**Scenario:** The same proof holds on Windows

Given `windows-latest`, the `windows-usage-wrappers` job
When the first two scenarios run unchanged from PowerShell
Then both pass.

**Requirement 30:** The proof of requirement 23 as modified by this delta
SHALL run on Linux and on `windows-latest`. Its test file SHALL join the
`windows-usage-wrappers` job. It SHALL use a scratch `HOME` and `USERPROFILE`, a
scratch `CREWRIG_USAGE_ROOT` and a stub target, and SHALL never touch the real
usage store or the network. The spawn is observed by a `NODE_OPTIONS --require`
preload stub; production code SHALL carry no test seam for it.

**Requirement 31:** `docs/cli-matrix.md` row 8d and the `[GAP]` entry "Usage mirror
on Windows" SHALL be updated in the same implementation diff: the gap is recorded
as closed, with the new test file named as evidence, and the sentence "Known gap:
the usage mirror's detached spawn needs `bash`" of row 8d is replaced accordingly.

## MODIFIED

Requirement 23, the usage-mirror gap. The first clause (Python and MemPalace
availability, as replaced by delta-03) is unchanged. Original, the usage-mirror
part as written by delta-01:

> One gap is certain and SHALL be recorded as a parity gap for (usage mirror x
> Windows): on a journal write that passes the gates of `onWrite` (a token file
> present, no backoff stamp younger than `CREWRIG_USAGE_MIRROR_BACKOFF_MS`, and
> `CREWRIG_USAGE_MIRROR` not `0`) `scripts/lib/usage-store/mirror.js` (lines 275
> and 276) spawns `bash scripts/usage-mirror.sh --from-write` detached, and Windows
> has no `bash`. The evidence is that code line; the plan records whether the spawn
> failure is handled, which no `error` listener on that spawn suggests it is not.
> This spec does not edit that JavaScript file (it is outside the edit set of
> requirement 22 and ratchet-exempt): the shim keeps the spawn working on
> POSIX, and the gap is pre-existing and not fixed here.
> `docs/cli-matrix.md` SHALL carry the
> gap on the row naming the usage mirror, or, when no row names it, in a note on
> row 11 or row 8d that the plan names.

Replacement:

> The usage-mirror gap (usage mirror x Windows) is closed. After the gates of
> `onWrite`, all unchanged (a token file present; no unreachable stamp younger than
> `CREWRIG_USAGE_MIRROR_BACKOFF_MS`; `CREWRIG_USAGE_MIRROR` not `0`; the pending
> marker written first), `scripts/lib/usage-store/mirror.js` SHALL spawn
> `process.execPath` with the argument list [absolute path of
> `scripts/usage-mirror.ts`, `"--from-write"`], with no shell, `detached: true`,
> `stdio: 'ignore'` and `windowsHide: true`, then call `unref()`. The spawn is never
> awaited and adds no latency to the write. An `error` listener SHALL be attached
> before `unref()` so that a failed spawn (`ENOENT`, `EACCES`, `EMFILE` and the
> like) never raises an unhandled event and never changes the outcome of the write:
> the pending marker is the recovery, since the next write's spawn or
> `usage-mirror --reconcile` retries it. No `bash` on `PATH` is required anywhere
> on this path. The earlier statement that this spec does not edit the JavaScript
> under `scripts/lib/usage-store/` is withdrawn for this one function.
> `scripts/usage-mirror.sh` is kept as a forwarding shim and is not deleted here.

Rejected alternatives:

- Calling `mirror.catchUp` in process from `onWrite`: rejected, because it
  would add latency to the hot-path write and break the detached, non-blocking contract.
- A `CREWRIG_USAGE_MIRROR_ENTRY` environment seam in production code so the test
  can redirect the spawn: rejected, because the preload stub needs no production
  surface.

## REMOVED

Nothing is removed. Out of scope: deleting `scripts/usage-mirror.sh` (the
shim-removal ticket J4, #1344, does it) and every other `docs/cli-matrix.md` row.

---
id: "0270"
slug: slim-always-loaded-rules
status: draft
complexity: standard
interaction-mode: AUTO
related-issue: 1727
version: 1.1.0
---

# Slim the always-loaded rules

This delta amends requirement 1, requirement 3 and requirement 15 of spec 0270
and narrows its scope, after the cold PLAN review seat `plan/1727` returned
REQUEST CHANGES on findings v1-F2 and v1-F3. The 10,240 B cap of requirement 1
cannot be met by relocating only the blocks that requirement 2 names, and the
plan that tried to meet it relocated behavioural sections (Idiomatic French,
Scannable Recap, Sequential Thinking, user-gate backend, Knowledge Graph
conventions, Memory Architecture tiers) that the spec never authorised. The
issue owner chose the realistic-cap route: the relocation set stays exactly the
non-behavioural list of requirement 2, and the cap is re-derived from a
measurement. No rule changes meaning.

Version bump: `1.0.0` to `1.1.0` (MINOR). The delta replaces one numeric cap and
narrows the scope without adding an obligation; no in-flight implementation
exists, so none is invalidated.

## ADDED

2a. Only the blocks enumerated in requirement 2 and the reviewer-seat exemption
of requirement 4 SHALL leave `60-tools.md`. The following sections SHALL stay
inline in `60-tools.md`, unchanged in text, and are out of scope for this spec:
*Memory Architecture — Three-Tier Model* (including the Tier 2 persistence
obligation and the Tier 3 rule that the agent MUST ask before writing),
*User-gate validation backend*, *Knowledge Graph Conventions*, *Sequential
Thinking — Working Memory Protocol*, *Memory Activation Summary*, *Scannable
Recap Format* and *Idiomatic French*. Slimming any of them is deferred to a later
work package that measures its behavioural effect first.

2b. Every block relocated under requirement 2 SHALL go to a new page under
`docs/`, not to the system-context store. Each stub SHALL carry, inline, the
operative clause an agent needs without opening the page: for the wake-up
block, that the optional store-mirror step is shed first when the budget would
be exceeded and is never a core sweep step; for the friction failure-mode
prose, that on error `-32001` or a write-lock refusal the first diagnostic step
is `task mempalace:status`. Each new `docs/` page SHALL declare the
`crewrig-doc` metadata block, and `docs/index.json` SHALL be regenerated in the
same diff (`node scripts/build-docs-index.ts --check` passes).

2c. The stub overhead SHALL be at most 1,600 B in total across the four stubs
(the bundled-script carve-out with the stdout hazard, the two *Why not*
rationales, the wake-up block, the friction failure-mode prose). The
reviewer-seat exemption leaves no stub: it stays stated in `AGENTS.md`
(*Session Bootstrap*) and `docs/reviewer-seat.md` per requirement 4.

**Scenario:** Realistic cap holds after the stubs are added

Given the named blocks are removed and the four stubs are added
When  `wc -c artifacts/core/rules/60-tools.md` runs
Then  the result is at most 25,300 and the recorded stub overhead is at most 1,600

**Scenario:** Behavioural sections are not touched

Given the implementation diff of `artifacts/core/rules/60-tools.md`
When  the *Idiomatic French*, *Scannable Recap Format*, *Sequential Thinking* and *User-gate validation backend* sections are compared with `main`
Then  their text is byte-identical

## MODIFIED

Original requirement 1:

> 1. `artifacts/core/rules/60-tools.md` SHALL keep only instructions an agent
>    needs in every session, and SHALL measure at most 10,240 bytes after this
>    spec is implemented (baseline 32,922).

Replacement:

> 1. `artifacts/core/rules/60-tools.md` SHALL keep only instructions an agent
>    needs in every session, within the relocation set of requirements 2, 2a and
>    4, and SHALL measure at most 25,300 bytes after this spec is implemented
>    (baseline 32,922). The plan stage SHALL record the measured post-move size;
>    the CI budget of requirement 10 derives from it.

Measurement on `origin/main` (9d737a76), `wc -c` over the line ranges of
`artifacts/core/rules/60-tools.md`:

| Block (requirement) | Bytes removed | Stub bytes added (cap) |
|---|---|---|
| Bundled-script carve-out (R2) | 1,365 | |
| Stdout hazard (R2) | 928 | |
| Carve-out and hazard, one stub | | 280 |
| Two *Why not* rationales (R2) | 1,270 | 260 |
| Wake-up budget table, Overflow rule, Staleness, Layered wake-up (R2) | 3,039 | 380 |
| Friction failure-mode prose (R2) | 1,735 | 520 |
| Reviewer-seat exemption (R4) | 953 | 0 |
| **Total** | **9,290** | **1,440** |

Arithmetic: 32,922 - 9,290 = 23,632 B after removal; plus the stub allowance
of 1,600 B (1,440 B drafted, 160 B headroom) = 25,232 B post-move; plus about
10 percent = 27,755 B, rounded up to the next hundred = 27,800 B. The
requirement-1 ceiling of 25,300 B is the post-move size rounded up to the next
hundred (25,232 to 25,300), a margin of 68 B over the estimate; the
requirement-10 budget is 27,800 B.

Original requirement 3:

> 3. Text that only concerns authors of bundled scripts or maintainers SHALL go to
>    `docs/`; text an agent may need during a session SHALL go to the store.
>    The plan stage SHALL record the destination of each relocated block and the
>    resulting store size, because the optional store mirror copies every store
>    file at session start.

Replacement:

> 3. Destinations are fixed by requirement 2b: every relocated block goes to
>    `docs/`, with the operative clause an agent needs kept in its stub. The
>    system-context store therefore stays at five files totalling 16,319 B
>    (measured on `origin/main`), and the optional store mirror's per-session
>    cost is unchanged. The *Wake-up budget* table, which records the mirror cap
>    (about 16 KB) and the total wake-up (about 24 KB), moves verbatim to its
>    `docs/` page with those figures unchanged, so no cap changes meaning; its
>    16,315 B figure is a pre-existing approximation of 16,319 B and is not
>    edited by this spec. The plan stage SHALL re-verify the store total with
>    `wc -c` before the move.

Original requirement 15:

> 15. The logbook SHALL record, before and after, E1 measured as the sum of
>     `AGENTS.md`, the files it imports, and every deployed rule on the Claude Code
>     install, itemised per file, together with E2 and the quality indicators Q1
>     to Q4 of epic section 4.2.

Replacement:

> 15. The logbook SHALL record, before and after, E1 measured as the sum of
>     `AGENTS.md`, the files it imports, and every deployed rule on the Claude Code
>     install, itemised per file, together with E2 and the quality indicators Q1
>     to Q4 of epic section 4.2. E1 is reported, not gated: the epic target of
>     20 KB is not an acceptance criterion of this ticket. The expected E1 is
>     about 57,000 B (today about 71,660 B; the tools rule falls by about 7,690 B
>     to 25,232 B, and `AGENTS.md` by about 6,900 B to roughly 15,000 B under
>     requirement 7), to be confirmed by the measurement.

Original scenario *Tools rule within budget*:

> Then  the result is at most 10,240

Replacement:

> Then  the result is at most 25,300

Original out-of-scope item:

> - Editing the adopter-owned layered files deployed beside the tools rule (...)

Replacement: unchanged, and extended with the deferral of requirement 2a: the
behavioural sections of `60-tools.md` listed there are out of scope for this
work package and are left to a later, measured one.

Decision record (AUTO):

- Measured: `60-tools.md` 32,922 B; named blocks 9,290 B; stubs 1,440 B drafted, 1,600 B allowed; post-move 25,232 B.
- Resolves the first AUTO-PARKED open question of spec 0270 for this ticket: E1 is reported in the logbook, not gated; the epic owner's decision on the E1 target remains a matter for the epic, outside this ticket.
- Rejected: relocating the behavioural sections to reach 10,240 B, because an agent may not follow a stub that is read only on demand, and spec 0270 requirement 6 forbids a meaning change.
- Rejected: keeping 10,240 B and leaving the ticket permanently red, because a requirement the named scope cannot meet is unverifiable.
- Rejected: relocating the wake-up block to the store, because it would grow the mirrored store and rewrite the cap it records.
- Risk: the stub text is not yet drafted, so the 1,440 B figure is an estimate. Mitigation: the 1,600 B stub ceiling of requirement 2c and the 25,300 B size ceiling are both asserted at implementation.

## REMOVED

None.

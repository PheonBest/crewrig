---
id: "0270"
slug: slim-always-loaded-rules
status: approved
complexity: standard
interaction-mode: AUTO
related-issue: 1727
version: 1.0.0
---

# Slim the always-loaded rules

## Intent

Every session and every spawned subagent re-reads the framework's always-loaded
context, and most of that text is maintainer rationale, script-author guidance
and one-time policy that an agent does not need in order to act. After this
spec, the deployed tools rule and `AGENTS.md` carry only what an agent needs in
every session, the rest stays reachable on demand, a deterministic check keeps
the deployed rules from growing back, and the installed copies on all four
supported CLIs match the repository. No rule changes meaning: this work package
changes where text lives, not what it says. It is work package WP2 of the
epic #1724 (sections 2.2, 4 and 6); the measured effect is the epic's
indicator E1 (always-loaded bytes per spawn).

## Requirements

Paths: the deployed tools rule is `artifacts/core/rules/60-tools.md`; the
on-demand store is `artifacts/core/system-context/`, installed to
`~/.crewrig/system-context/`. Sizes are bytes as reported by `wc -c`.

1. `artifacts/core/rules/60-tools.md` SHALL keep only instructions an agent
   needs in every session, and SHALL measure at most 10,240 bytes after this
   spec is implemented (baseline 32,922).
2. The following text SHALL leave `60-tools.md` and SHALL be relocated to the
   system-context store or to a file under `docs/`, each with a stub in
   `60-tools.md` that names the new location: the MemPalace bundled-script
   carve-out and the stdout hazard; the rationale paragraphs *Why not
   `mempalace_search` without a wing filter?* and *Why not
   `mempalace_diary_read` for cross-tool resume?*; the *Wake-up budget* table,
   the *Overflow rule*, the *Staleness* paragraph and the *Layered wake-up is
   not an agent action* paragraph; and the detailed friction-reporting
   failure-mode prose (the `-32001` and half-converted-machine discussion),
   which the `harness-report` skill already carries.
3. Text that only concerns authors of bundled scripts or maintainers SHALL go to
   `docs/`; text an agent may need during a session SHALL go to the store.
   The plan stage SHALL record the destination of each relocated block and the
   resulting store size, because the optional store mirror copies every store
   file at session start.
4. The reviewer-seat exemption paragraph SHALL be removed from `60-tools.md`
   and SHALL remain stated in `AGENTS.md` (*Session Bootstrap*) and in
   `docs/reviewer-seat.md`, so a rule deployed to every adopter project no
   longer carries a CrewRig-specific carve-out, and no seated-pass obligation
   is lost.
5. Text SHALL be moved verbatim in one commit and trimmed or replaced by stubs
   only in a later, separate commit, so a reviewer can diff the moved text
   against the original.
6. No rule, obligation, prohibition or condition in `60-tools.md` or
   `AGENTS.md` SHALL change meaning. Every relocated block SHALL be reachable
   from the file it left through an explicit stub naming its new path, and
   every store file SHALL be listed in, and retrievable through, the
   *Retrieving the system-context store* protocol.
7. `AGENTS.md` SHALL reduce each section named here to a pointer of one to three
   lines plus at most one critical rule: the *What is CrewRig?* five-pillar
   introduction, the ASCII lifecycle diagram (keeping the link to ADR-0010),
   and *Language*. The *Legacy ticket policy* section SHALL be reduced to a
   pointer to `docs/legacy-ticket-policy.md`, which keeps the full text. The
   full text of every shortened section SHALL remain in a doc under `docs/`
   that `AGENTS.md` links to.
8. `AGENTS.md` SHALL keep every rule currently marked critical or enforced by a
   deterministic check (for example the Pre-Edit Guard conditions, the
   no-merge-without-permission rule and the version-bump rule), unchanged in
   meaning.
9. After the change, the `check-agents-size.ts` threshold SHALL be set to the
   new `AGENTS.md` size plus approximately 10 percent, rounded up to the next
   hundred bytes, and its unit test SHALL assert the new value. The plan stage
   SHALL fix the number from the measured post-trim size and record it.
10. A new deterministic check SHALL fail when the total size of
    `artifacts/core/rules/*.md` exceeds a budget, SHALL print the measured total
    and the budget, and SHALL be wired into CI in the same way as
    `check-agents-size.ts` (its own job in `.github/workflows/build.yml`, a
    path-filtered test entry, and a `*-ci-wiring` test). The budget SHALL be the
    post-trim total plus approximately 10 percent, recorded in the check's
    header and its unit test.
11. The new check SHALL NOT count any file outside `artifacts/core/rules/`, and
    SHALL fail closed when the directory is unreadable or holds no rule files.
12. After implementation, a re-deploy on each of Claude Code, Gemini CLI, GitHub
    Copilot CLI and Antigravity CLI SHALL be verified: for each CLI the installed
    copy of the tools rule and of every store file SHALL be byte-identical to
    the repository source, and the evidence (command and result per CLI)
    SHALL be recorded in the logbook. This resolves the installed-rules drift
    noted in epic section 2.7.
13. The change SHALL ship symmetrically for the four CLIs. Any CLI where a
    relocated block or stub cannot be delivered the same way SHALL carry
    concrete evidence of the missing mechanism, and `docs/cli-matrix.md` SHALL be
    updated in the same diff where an integration point changes.
14. The markdown-link check, the spec linter, the version-bump check, the
    typecheck, the test suite, and every `*-ci-wiring` test SHALL pass, and none
    SHALL be disabled or loosened. Commits touching `artifacts/` SHALL include
    outputs regenerated by `node scripts/build-components.ts` after
    `node scripts/lib/node-floor-guard.js`, and the core-paths manifest SHALL be
    updated if a core-layer path is added.
15. The logbook SHALL record, before and after, E1 measured as the sum of
    `AGENTS.md`, the files it imports, and every deployed rule on the Claude Code
    install, itemised per file, together with E2 and the quality indicators Q1
    to Q4 of epic section 4.2.
16. The implementation SHALL NOT ship in the same pull request as any other
    work package of epic #1724.

## Scenarios

**Scenario:** Tools rule within budget

Given the implementation is merged
When  `wc -c artifacts/core/rules/60-tools.md` runs
Then  the result is at most 10,240

**Scenario:** A relocated block stays reachable

Given the *Wake-up budget* table has left `60-tools.md`
When  an agent follows the stub that replaced it
Then  the stub names a path that exists, the direct read of that path returns the verbatim original text, and the markdown-link check passes

**Scenario:** Rules growth is caught

Given the rules budget is 11,200 bytes
When  a change grows `artifacts/core/rules/` to 11,300 bytes
Then  the new CI job fails and prints the measured total and the budget

**Scenario:** AGENTS.md growth is caught at the lowered threshold

Given the lowered threshold is N bytes
When  `AGENTS.md` reaches N bytes
Then  `check-agents-size.ts` exits 1

**Scenario:** Meaning is preserved by the two-commit rule

Given the verbatim-move commit and the stub-and-trim commit are diffed
When  a reviewer finds an obligation that differs from the original
Then  the finding is `tech` class and the trim commit is corrected before merge

**Scenario:** Re-deploy verification on all four CLIs

Given the change is merged and setup is re-run for each CLI
When  the installed tools rule is compared with the repository source
Then  the bytes match for Claude Code, Gemini CLI, GitHub Copilot CLI and Antigravity CLI, and the per-CLI evidence is in the logbook

**Scenario:** Seated pass keeps its exemption

Given the exemption is no longer in the deployed tools rule
When  a seated pass reads `AGENTS.md` *Session Bootstrap*
Then  it still finds the exemption from steps 3 and 6, unchanged in meaning

## Out of scope

- Any change to what a rule says; only location, stubs and trimming that preserves meaning.
- The memory-sweep changes of WP3 (orchestrator-only sweep, dropping `mempalace_status`), document splitting of WP4, ceremony changes of WP6, and the skill changes of WP1.
- Editing the adopter-owned layered files deployed beside the tools rule (`00-soul`, `10-level`, `20-organization`, `30-profile`, `40-expertise`, `65-org-tools`) and the `AGENTS.org.md` import.
- Rewriting the `harness-report` skill; it is only cited as the existing home of the failure-mode procedure.
- Changing how the optional store mirror works, beyond recording the store size it must carry.

## Open questions

- [AUTO-PARKED] E1 of 20 KB is unreachable within this ticket's listed scope. Measured on 2026-10-20 on the Claude Code install of the maintainer: `AGENTS.md` 21,893; `AGENTS.org.md` 1,733 (imported); tools rule 32,922 in the repository (31,997 installed); the other six deployed rules 15,112 (`00-soul` 5,741, `10-level` 4,301, `20-organization` 1,428, `30-profile` 2,276, `40-expertise` 922, `65-org-tools` 444). E1 therefore is about 71,660 today. With the tools rule at 10,240 and the other six untouched at 15,112, the rules alone are about 25,350, above 20,000 before counting `AGENTS.md`. Even if `AGENTS.md` fell to 12,000 and `AGENTS.org.md` stays 1,733, E1 would be about 39,100. Reaching 20 KB would need the adopter-owned layered files (notably `00-soul` and `10-level`, about 10 KB together) to shrink, which the ticket does not list. Default: this spec fixes the hard, testable budgets (requirements 1, 9 and 10) and reports E1 as measured; the plan stage SHALL ask the epic owner whether to amend the E1 target (suggested interim target: 40 KB) or to open a work package for the layered files. Requirements 1 to 16 do not depend on the answer.
- [AUTO-PARKED] Numeric post-trim size of `AGENTS.md` is not fixed here. The candidates named in the ticket total roughly 108 of its 380 lines; the plan stage measures the result and sets requirement 9 from it (expected near 15,000 bytes, threshold near 16,500).
- [AUTO-PARKED] Destination (store or `docs/`) for each relocated block is a plan-stage decision under requirement 3. A risk to check: moving more into the store raises the optional mirror's per-session cost, and the mirror table that records its cap is itself being relocated.
- [AUTO-PARKED] Existing tests or specs may assert the presence of the reviewer-seat exemption or other moved text inside `60-tools.md`; the plan stage greps for such assertions before the move and updates them in the same diff.
- Decision (AUTO): the rules budget check counts only `artifacts/core/rules/*.md` (today a single file), as the ticket specifies; the E1 total across layers is a logbook measurement, not a CI gate.

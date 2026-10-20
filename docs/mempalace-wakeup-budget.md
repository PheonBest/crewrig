# MemPalace wake-up budget

<!-- crewrig-doc: published=false -->

<!-- Extracted verbatim from artifacts/core/rules/60-tools.md lines 326-372. Cross-references to other sections refer to that file. -->

**Wake-up budget (bounded).** The session-start sweep above has a largely
bounded, documented cost — bounded by construction for every core step
except `mempalace_status`, the one global, unscoped call (see the
*Overflow rule* below). It is denominated in **bytes** — the unit an
agent can verify directly (`wc -c`) — with `~4 bytes/token` stated as an
approximation (the true ratio varies by tokenizer and content).

| Sweep component | Payload | ≈ tokens (@ ~4 B/tok) | Cap |
|---|---|---|---|
| Core sweep (the six numbered steps): `mempalace_status` + scoped `[TASK:ongoing]` search + `diary_read(last_n≤5)` + one `kg_query` + conditional checkpoint write | documented estimate (see issue #415) | — | ~8 KB (~2,000 tok) |
| Optional store mirror: the 5 × `~/.crewrig/system-context/*.md` files, verbatim | 16,315 B | ~4,079 | ~16 KB (~4,000 tok) |
| **Total wake-up (with mirror)** | | | **~24 KB (~6,000 tok)** |

**Overflow rule.** If the budget would be exceeded, shed the optional
store-mirror step first — its direct-file-read fallback (see *Retrieving
the system-context store*) stays always-available, so shedding it leaves
no rule unreachable. Never shed a core numbered step: the six steps are
the deterministic resume path, and all but one are scoped by construction
(the `[TASK:ongoing]` lookup is wing+room-filtered, `diary_read` is
bounded by `last_n`, the `kg_query` is a single-entity lookup). The
exception is `mempalace_status` (the sweep's first call): it is **global
and unscoped** — the MCP surface exposes no scoping parameter — so its
payload grows with the palace's total wing/room count, dominated by the
`transcripts` archive, and in a mature multi-project install can alone
approach or exceed the ~8 KB core cap (observed ~18–20 KB against the
authoring palace; see issue #415). Its recourse is structural, not a
smaller payload: `status` is read **once** — to enumerate the wings and
note which (the `transcripts` archive) to exclude from the scoped steps
that follow — then discarded, not retained verbatim or re-requested, so
its transient read size is not a sustained context cost. Treat it as
**best-effort**, not a figure the ~8 KB cap can guarantee.

**Staleness.** The optional store-mirror step uses
`mempalace_check_duplicate` (or a stored content hash) to skip drawers
already mirrored verbatim, so it does not re-read and re-write every
drawer each session.

**Layered wake-up is not an agent action.** MemPalace's native layered
wake-up (`L0–L3` / `MemoryStack.wake_up()`, exposed on the CLI as
`wake-up`) is **not** reachable from an agent's reasoning loop: it is
absent from the MCP tool surface and is therefore forbidden by the
**MCP-only access from the agent prompt** guard at the head of this
MemPalace section. This deterministic sweep (the six numbered steps plus
the optional store-mirror step) is its bounded substitute — the
conceptual target it stands in for is MemPalace's `L0+L1` ≈ 600–900
tokens (see issue #415 and `docs/cli-matrix.md` row 7g).

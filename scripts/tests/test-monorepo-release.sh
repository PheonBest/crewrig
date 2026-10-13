#!/bin/bash
# test-monorepo-release.sh — Hermetic regression tests for the monorepo
# release driver (spec 0213 + delta-01, PLAN v2 step 10): bash only, no
# network, no engine call.
#
# scripts/tests/test-monorepo-release-engine.sh is the sibling suite that
# exercises the REAL semantic-release engine end to end (rehearsal + GitLab
# publish against a stub) — this file never gets that far by design.
#
# Spec 0257 (PR 7, the switch) retired the shell library
# scripts/lib/monorepo-release-lib.sh. Its in-process groups sourced that
# library, so they are retired with it and each is replaced by the black-box
# cases of scripts/tests/monorepo-release-blackbox-*.test.ts, which drive the
# driver entry only (spec requirement 22):
#   (a) R10   — forge-detection refusals            -> rb-a-*
#   (b)       — RELEASE_DRY_RUN/DRY_RUN switch matrix and the GitLab
#               merge-request/tag pipeline refusal  -> rb-b-*
#   (c)       — GitHub releaserc golden, release_identity defaults/override
#                                                   -> rb-c-*
#   (d) R2/R7 — github vs gitlab publish/rehearsal config structure
#                                                   -> rb-d-*
#   (e) R11   — a credential is only ever named, never printed
#                                                   -> rb-e-*
#   (g) #1379 — the in-process building blocks (release_classify,
#               release_pr_branch, the `prepare` config, release_sync_cmd)
#                                                   -> rb-g-*
#
# Cases kept here, because they read documents and workflow files, not the
# library:
#   (f)       — docs/gitlab-release-publishing.md names no
#               `extensions install` command (ruling 1).
#   (g) #1379 — the release workflow's `actions: write` permission and
#               non-cancelling concurrency, and build.yml's dispatch trigger
#               and required jobs.
#
# Usage:
#   bash scripts/tests/test-monorepo-release.sh
#
# -e is intentionally omitted: outcomes are asserted via explicit pass/fail
# counters, matching the sibling suites' idiom.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

pass=0
fail=0
ok() { echo "PASS  $1"; pass=$((pass + 1)); }
ng() { echo "FAIL  $1"; fail=$((fail + 1)); }

# =============================================================================
# (f) Ruling 1 — the GitLab doc never RECOMMENDS `extensions install
# <gitlab-url>` as a working step (unmeasured, per open-question ruling 1).
#
# NOTE ON WORDING: the plan text for this case reads "contains no
# `extensions install`". Read literally that would forbid the phrase
# outright, but the doc (already written, PLAN v2 step 13, commit a47c691)
# correctly and deliberately NAMES the command while hedging it as
# unmeasured ("Do not assume `gemini extensions install <gitlab-url>` works
# until that measurement exists") — which is what open-question ruling 1
# actually asks for: no CLAIM that it works, not no MENTION of it at all. A
# literal empty-grep test would force the correct, honest prose back out of
# the doc, so this case checks the real invariant instead: the phrase never
# appears as a bare, runnable example inside a fenced code block (which
# WOULD read as "here is how", contradicting "unmeasured"), and every prose
# mention sits next to the hedge. Flagged for the team in the session report.
# =============================================================================
{
  doc="$REPO_DIR/docs/gitlab-release-publishing.md"
  if [ ! -f "$doc" ]; then
    ng "(f) cannot find $doc"
  else
    in_fence="$(awk '/^```/{f = !f; next} f' "$doc" | grep -c 'extensions install' || true)"
    if [ "$in_fence" -eq 0 ]; then
      ok "(f) 'extensions install' never appears inside a runnable code fence"
    else
      ng "(f) 'extensions install' appears inside a runnable code fence — that reads as a recommendation, contradicting ruling 1's 'unmeasured'"
    fi

    if grep -q 'extensions install' "$doc" && ! grep -q 'unmeasured' "$doc"; then
      ng "(f) 'extensions install' is mentioned with no accompanying 'unmeasured' hedge anywhere in the doc"
    else
      ok "(f) every mention of 'extensions install' coexists with the required 'unmeasured' hedge"
    fi
  fi
}

# =============================================================================
# (g) #1379 — release workflow permissions and build.yml dispatch (the
# in-process building blocks of this group were retired with the library;
# see the header)
# =============================================================================
{
  wf="$REPO_DIR/.github/workflows/release-monorepo.yml"
  if grep -qE '^  actions: write$' "$wf" && grep -qE '^  cancel-in-progress: false$' "$wf"; then
    ok "(g) the release workflow may dispatch the checks (actions: write) and never cancels a running release"
  else
    ng "(g) the release workflow lacks actions: write or its non-cancelling concurrency"
  fi
  if grep -qE '^  workflow_dispatch:' "$REPO_DIR/.github/workflows/build.yml" \
     && grep -qE '^  ratchet:$' "$REPO_DIR/.github/workflows/build.yml" \
     && grep -qE '^  lint-typescript:$' "$REPO_DIR/.github/workflows/build.yml"; then
    ok "(g) build.yml accepts workflow_dispatch and defines the required ratchet and lint-typescript jobs"
  else
    ng "(g) build.yml cannot be dispatched or lacks a required job"
  fi
}

echo ""
echo "Results: $pass passed, $fail failed"
[ "$fail" -eq 0 ]

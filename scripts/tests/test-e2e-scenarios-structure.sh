#!/usr/bin/env bash
# test-e2e-scenarios-structure.sh — Structural test for the four pillar
# scenarios scaffolded by issue #80.
#
# Verifies that each scenario directory under tests/e2e/scenarios/ ships
# the contract surface required by the runner (ADR 0005 Decision 3):
#
#   - run.sh exists and is executable
#   - run.sh parses under `bash -n` (no shell-syntax rot)
#   - run.sh sources at least one helper from $E2E_LIB_DIR (proof that
#     it honors the runner-injected library directory)
#   - tests/e2e/scenarios/README.md exists and is non-empty
#   - tests/e2e/defaults.toml declares a [scenarios.<name>] table for
#     every directory present on disk
#
# Host-side, no Docker, no auth. Safe to run in CI.

set -uo pipefail

PASS=0
FAIL=0
SKIP=0

note_pass() { echo "# PASS $1"; PASS=$((PASS + 1)); }
note_fail() { echo "# FAIL $1 — $2"; FAIL=$((FAIL + 1)); }
note_skip() { echo "# SKIP $1: $2"; SKIP=$((SKIP + 1)); }

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCEN_DIR="${REPO_DIR}/tests/e2e/scenarios"
DEFAULTS_TOML="${REPO_DIR}/tests/e2e/defaults.toml"
README="${SCEN_DIR}/README.md"

SCENARIOS=(01-layered-context 02-cross-tool-memory 03-skill-build 04-harness-loop 05-copilot-model-routing 06-agent-surface-consumption 07-guidance-surface)

# --- Behavioural driver (spec 0261 requirements 12-15) -----------------------
# Static reads of the scenario/runner TEXT are replaced by runs of tests/e2e/run.sh
# against the Docker stand-in (scripts/tests/lib/e2e-docker-standin.ts); the docker
# argv it logs is what is asserted. drive_case <scenario> <cli> [stdout] [seed-modes]
# sets DRV_RC DRV_DIR DRV_LOG (one JSON argv per line) DRV_REPORT DRV_BUNDLE.
DRV_BASE="$(mktemp -d "${TMPDIR:-/tmp}/crewrig-e2e-drv.XXXXXX")"
trap 'rm -rf "$DRV_BASE"' EXIT
DRV_N=0
DRV_OK=false
if [ "$(bash -c 'echo ${BASH_VERSINFO[0]}')" -ge 4 ] && command -v node >/dev/null 2>&1; then DRV_OK=true; fi
drive_case() {
  local scenario="$1" cli="$2" out="${3:-x}" seed="${4:-}"
  DRV_N=$((DRV_N + 1))
  DRV_DIR="${DRV_BASE}/c${DRV_N}"
  DRV_BUNDLE="${DRV_DIR}/e2e-root/.crewrig-e2e/${cli}"
  mkdir -p "${DRV_DIR}/home" "${DRV_DIR}/bin" "${DRV_DIR}/state" "${DRV_DIR}/tmp"
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON "${REPO_DIR}/scripts/tests/lib/e2e-docker-standin.ts" --write-launcher "${DRV_DIR}/bin"
  if [[ "$seed" != "absent-bundle" ]]; then
    mkdir -p "${DRV_BUNDLE}"
    echo '# Location: Nantes' > "${DRV_BUNDLE}/00-rules.md"
    echo '{"dummy":true}' > "${DRV_BUNDLE}/.credentials.json"
  fi
  if [[ "$seed" == "loose-modes" ]]; then
    mkdir -p "${DRV_BUNDLE}/sub"; chmod 755 "${DRV_BUNDLE}/sub"; chmod 644 "${DRV_BUNDLE}/.credentials.json"
  fi
  jq -n --arg k "${scenario}/${cli}" --arg o "$out" '{($k):[range(0;5)|{match:["run"],stdout:$o}]}' > "${DRV_DIR}/state/f.json"
  DRV_REPORT="${DRV_DIR}/reports/20000101T000000Z-0000/${cli}/${scenario}"
  (cd "$REPO_DIR" && env -i PATH="${DRV_DIR}/bin:${PATH}" HOME="${DRV_DIR}/home" \
    CREWRIG_E2E_HOME="${DRV_DIR}/e2e-root" E2E_REPORTS_ROOT="${DRV_DIR}/reports" TMPDIR="${DRV_DIR}/tmp" LC_ALL=C \
    ANTHROPIC_API_KEY=d GEMINI_API_KEY=d COPILOT_GITHUB_TOKEN=d E2E_JUDGE_MOCK=1 \
    E2E_JUDGE_MOCK_RESPONSE="VERDICT=PASS CONF=0.95" E2E_STANDIN_FIXTURES="${DRV_DIR}/state/f.json" \
    E2E_STANDIN_CASE="${scenario}/${cli}" E2E_STANDIN_STATE="${DRV_DIR}/state/c" E2E_STANDIN_LOG="${DRV_DIR}/state/log.jsonl" \
    bash tests/e2e/run.sh --scenario "$scenario" --cli "$cli" --report-dir "${DRV_DIR}/reports/20000101T000000Z-0000" \
    >"${DRV_DIR}/out" 2>&1)
  DRV_RC=$?
  DRV_LOG="${DRV_DIR}/state/log.jsonl"
  [[ -f "$DRV_LOG" ]] || : > "$DRV_LOG"
}
# is_real_shell <file> — false for a three-line forwarding shim (`exec node ...`); spec 0261 requirement 14.
is_real_shell() {
  local f="$1" first
  first="$(grep -v '^[[:space:]]*#' "$f" | grep -v '^[[:space:]]*$' | head -n 1)"
  case "$first" in exec\ node*) return 1 ;; esac
  [ "$(wc -l < "$f" | tr -d ' ')" -gt 5 ]
}

# --- 1. Each scenario dir + run.sh present and executable --------------------
for s in ${SCENARIOS[@]+"${SCENARIOS[@]}"}; do
  d="${SCEN_DIR}/${s}"
  r="${d}/run.sh"
  if [[ ! -d "$d" ]]; then
    note_fail "scenario '$s' — directory exists" "missing at $d"
    continue
  fi
  if [[ -x "$r" ]]; then
    note_pass "scenario '$s' — run.sh exists and is executable"
  else
    note_fail "scenario '$s' — run.sh executable" "not -x: $r"
  fi
done

# --- 2. Each run.sh passes `bash -n` syntax check ----------------------------
for s in ${SCENARIOS[@]+"${SCENARIOS[@]}"}; do
  r="${SCEN_DIR}/${s}/run.sh"
  [[ -f "$r" ]] || continue
  # Shell-only property: a forwarding shim is not parsed by bash -n (spec 0261 requirement 14).
  is_real_shell "$r" || { note_pass "scenario '$s' — bash -n not applicable (forwarding shim, spec 0261 requirement 14)"; continue; }
  err="$(bash -n "$r" 2>&1)"
  if [[ -z "$err" ]]; then
    note_pass "scenario '$s' — bash -n syntax check"
  else
    note_fail "scenario '$s' — bash -n syntax check" "$(echo "$err" | tr '\n' '|')"
  fi
done

# --- 3. Each run.sh sources a helper from $E2E_LIB_DIR -----------------------
# Accept any of: assert.sh, structural.sh, llm_judge.sh (the v1 lib set).
for s in ${SCENARIOS[@]+"${SCENARIOS[@]}"}; do
  r="${SCEN_DIR}/${s}/run.sh"
  [[ -f "$r" ]] || continue
  # Shell-only property: a forwarding shim sources nothing (spec 0261 requirement 14); the library
  # directory contract is exercised behaviourally by every drive_case run below.
  is_real_shell "$r" || { note_pass "scenario '$s' — \$E2E_LIB_DIR sourcing not applicable (forwarding shim, spec 0261 requirement 14)"; continue; }
  if grep -Eq 'source[[:space:]]+"\$\{?E2E_LIB_DIR\}?/' "$r" \
     || grep -Eq '\.[[:space:]]+"\$\{?E2E_LIB_DIR\}?/' "$r"; then
    note_pass "scenario '$s' — sources \$E2E_LIB_DIR helper"
  else
    note_fail "scenario '$s' — sources \$E2E_LIB_DIR helper" \
              "no 'source \"\${E2E_LIB_DIR}/...\"' line found"
  fi
done

# --- 4. scenarios/README.md exists and is non-empty --------------------------
if [[ -s "$README" ]]; then
  note_pass "scenarios/README.md — present and non-empty"
else
  note_fail "scenarios/README.md — present and non-empty" "missing or empty: $README"
fi

# --- 5. defaults.toml declares [scenarios.<name>] for each scenario ---------
if [[ ! -f "$DEFAULTS_TOML" ]]; then
  note_fail "defaults.toml — present" "missing at $DEFAULTS_TOML"
else
  for s in ${SCENARIOS[@]+"${SCENARIOS[@]}"}; do
    if grep -Eq "^\[scenarios\.${s}\]" "$DEFAULTS_TOML"; then
      note_pass "defaults.toml — [scenarios.${s}] table present"
    else
      note_fail "defaults.toml — [scenarios.${s}] table present" \
                "no '[scenarios.${s}]' header found"
    fi
  done
fi

# --- 6. Duplicate-mount guard (PLAN v2 step 19; spec 0261 requirement 12) ----
# Behavioural: a scenario must not pass two `-v` mounts for one container path with different
# host/mode strings (measured in PLAN v2 step 17: docker exit 125 "Duplicate mount point"). Asserted
# on the docker argv recorded by the stand-in for each passing case, not on the scenario text. A
# byte-identical repeat (01-layered-context/claude's rules mount versus [cli.claude].mounts[0]) is the
# documented tolerated case; the copilot ephemeral-home substitution (v2-F4) shows up as a single
# mount of /home/agent/.copilot. Probe A (05) needs tests/e2e/local.toml and cannot be driven.
if [[ "$DRV_OK" == "true" ]] && command -v yq >/dev/null 2>&1 && command -v jq >/dev/null 2>&1; then
  for pair in 01-layered-context:claude 01-layered-context:gemini 01-layered-context:copilot \
              06-agent-surface-consumption:copilot 06-agent-surface-consumption:claude 07-guidance-surface:claude; do
    s="${pair%%:*}"; cli="${pair##*:}"
    drive_case "$s" "$cli" "Nantes"
    ncalls="$(grep -c '"run"' "$DRV_LOG" || true)"
    if [[ "$ncalls" -lt 1 ]]; then
      note_fail "scenario '$s' [$cli] — recorded docker run for the duplicate-mount check" "no docker run recorded (rc=$DRV_RC)"
      continue
    fi
    dups="$(jq -c '.argv | . as $a | [range(0;length-1) | select($a[.]=="-v") | $a[.+1]] | group_by(split(":")[1]) | map(select((unique|length)>1)) | select(length>0)' "$DRV_LOG")" \
      || { note_fail "scenario '$s' [$cli] — duplicate-mount analysis" "jq could not read the recorded argv"; continue; }
    if [[ -z "$dups" ]]; then
      note_pass "scenario '$s' [$cli] — no conflicting duplicate -v container path in the recorded docker argv"
    else
      note_fail "scenario '$s' [$cli] — no conflicting duplicate -v container path" \
        "same container path mounted with different host/mode: $dups (regression class: PLAN v2 step 17)"
    fi
  done
else
  note_skip "duplicate-mount guard" "bash>=4/node/yq/jq unavailable"
fi

echo ""
echo "# $PASS passed / $FAIL failed / $SKIP skipped"
[[ "$FAIL" -eq 0 ]]

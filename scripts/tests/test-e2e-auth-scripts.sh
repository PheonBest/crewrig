#!/bin/bash
# test-e2e-auth-scripts.sh — Regression test for scripts/e2e/auth-*.sh.
#
# Locks the per-script invariants required by docs/adr/0002-e2e-auth-flow.md:
#
#   - bash shebang + `set -euo pipefail` + clean `bash -n` syntax (only
#     while the file is a real shell script; spec 0261 R14)
#   - lib/auth-common.sh helpers are in effect (observed through the
#     image-missing error the shared e2e_require_image helper emits)
#   - claude/gemini: image precondition fires when image is missing;
#                    e2e_chown_bootstrap is invoked (observed through its
#                    "Asserting writability" line on a full stand-in run)
#   - copilot:       PAT-creation URL, export hint, and 90-day reminder
#                    appear in the guidance banner when no token is set;
#                    exit code is 0 when the script only prints guidance
#
# Every run goes through the Docker stand-in (scripts/tests/lib/e2e-docker-standin.ts)
# with a scratch HOME and CREWRIG_E2E_HOME: never real docker, never the real HOME.

set -uo pipefail

PASS=0
FAIL=0
SKIP=0

note_pass() { echo "PASS  $1"; PASS=$((PASS + 1)); }
note_fail() { echo "FAIL  $1 — $2"; FAIL=$((FAIL + 1)); }
note_skip() { echo "SKIP  $1 — $2"; SKIP=$((SKIP + 1)); }

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPTS_DIR="${REPO_DIR}/scripts/e2e"

STANDIN="${REPO_DIR}/scripts/tests/lib/e2e-docker-standin.ts"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin" "$TMP/home/.claude/rules" "$TMP/home/.copilot/instructions"
echo "rule" > "$TMP/home/.claude/rules/00-test.md"
echo "rule" > "$TMP/home/.copilot/instructions/00-test.instructions.md"
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON "$STANDIN" --write-launcher "$TMP/bin"
cat > "$TMP/fixtures.json" <<'JSON'
{
  "auth/claude": [{"files": {"/home/agent/.claude/.credentials.json": "{}", "/home/agent/.claude.json": "{}"}}],
  "auth/gemini": [{"files": {"/home/agent/.gemini/oauth_creds.json": "{}", "/home/agent/.gemini/settings.json": "{}"}}],
  "auth/copilot": [{"stdout": "1.0.0\n"}]
}
JSON

RUN_SEQ=0
# run_auth <cli> [VAR=value ...] — run scripts/e2e/auth-<cli>.sh against the stand-in
# with a fresh scratch e2e home; sets out/rc. Extra VAR=value pairs go to the script env.
run_auth() {
  local cli="$1"; shift
  RUN_SEQ=$((RUN_SEQ + 1))
  local state="$TMP/state-$RUN_SEQ"
  mkdir -p "$state"
  out="$(env -u COPILOT_GITHUB_TOKEN HOME="$TMP/home" CREWRIG_E2E_HOME="$TMP/e2e-$RUN_SEQ" \
    PATH="$TMP/bin:$PATH" E2E_STANDIN_FIXTURES="$TMP/fixtures.json" \
    E2E_STANDIN_CASE="auth/${cli}" E2E_STANDIN_STATE="$state" \
    E2E_STANDIN_LOG="$state/docker.log" "$@" \
    bash "${SCRIPTS_DIR}/auth-${cli}.sh" </dev/null 2>&1)"
  rc=$?
}

# True while the file is a real shell script, false once it is a forwarding
# shim (<= 5 lines, or first non-comment line is `exec node`).
# R14/R16: a shim is at most 25 lines AND has a line starting with `exec node` (floor-guard line comes first).
is_real_shell() {
  local f="$1" n
  n="$(wc -l < "$f" | tr -d ' ')"
  if [ "$n" -le 25 ] && grep -q '^exec node' "$f"; then return 1; fi
  [ "$n" -gt 5 ]
}

# ---------------------------------------------------------------------------
# Generic invariants — every auth-*.sh script
# ---------------------------------------------------------------------------
SCRIPTS=(auth-claude.sh auth-gemini.sh auth-copilot.sh)

for s in ${SCRIPTS[@]+"${SCRIPTS[@]}"}; do
  path="${SCRIPTS_DIR}/$s"
  cli="${s#auth-}"; cli="${cli%.sh}"

  if [[ -f "$path" ]]; then
    note_pass "$s — file exists"
  else
    note_fail "$s — file exists" "missing at $path"
    continue
  fi

  # Spec 0261 R14: shell-only properties (not oracles for a TypeScript port
  # behind a forwarding shim) are checked only while the file is real shell.
  if is_real_shell "$path"; then
    if [[ -x "$path" ]]; then
      note_pass "$s — executable bit set"
    else
      note_fail "$s — executable bit set" "chmod +x missing"
    fi

    shebang="$(head -n 1 "$path")"
    if [[ "$shebang" == "#!/usr/bin/env bash" || "$shebang" == "#!/bin/bash" ]]; then
      note_pass "$s — bash shebang ($shebang)"
    else
      note_fail "$s — bash shebang" "got '$shebang'"
    fi

    if head -n 30 "$path" | grep -qE '^set -euo pipefail\b'; then
      note_pass "$s — set -euo pipefail near top"
    else
      note_fail "$s — set -euo pipefail" "not found in first 30 lines"
    fi

    if bash -n "$path" 2>"$TMP/syntax.err"; then
      note_pass "$s — bash -n syntax check"
    else
      note_fail "$s — bash -n syntax check" "$(tr '\n' ' ' <"$TMP/syntax.err")"
    fi
  else
    note_skip "$s — shell-only checks (exec bit, shebang, set -euo pipefail, bash -n)" \
              "forwarding shim (spec 0261 R14)"
  fi

  # Behavioural replacement of "sources lib/auth-common.sh": with the image
  # reported missing, the shared e2e_require_image helper must fire, exit
  # non-zero and name the image. (copilot only reaches it with a token set.)
  if [[ "$cli" == "copilot" ]]; then
    run_auth "$cli" E2E_STANDIN_MISSING_IMAGES="crewrig/e2e-${cli}:latest" COPILOT_GITHUB_TOKEN=dummy
  else
    run_auth "$cli" E2E_STANDIN_MISSING_IMAGES="crewrig/e2e-${cli}:latest"
  fi
  if [[ "$rc" -ne 0 ]] && grep -q "image 'crewrig/e2e-${cli}:latest' is not present locally" <<< "$out"; then
    note_pass "$s — shared lib/auth-common.sh helpers in effect (e2e_require_image error, rc=$rc)"
  else
    note_fail "$s — shared lib/auth-common.sh helpers in effect" \
      "rc=$rc, output=$(printf '%s' "$out" | tr '\n' ' ' | head -c 200)"
  fi
done

# ---------------------------------------------------------------------------
# Interactive container scripts: claude + gemini
# ---------------------------------------------------------------------------
INTERACTIVE=(claude gemini)

for cli in ${INTERACTIVE[@]+"${INTERACTIVE[@]}"}; do
  s="auth-${cli}.sh"

  # --- e2e_chown_bootstrap invocation (full successful stand-in run) --------
  run_auth "$cli"
  if [[ "$rc" -eq 0 ]] && grep -q "\[${cli}\] Asserting writability on " <<< "$out"; then
    note_pass "$s — calls e2e_chown_bootstrap (writability line emitted, rc=0)"
  else
    note_fail "$s — calls e2e_chown_bootstrap" \
      "rc=$rc, output=$(printf '%s' "$out" | tr '\n' ' ' | head -c 200)"
  fi

  # --- Image precondition fires when image is missing ----------------------
  # The stand-in reports the image missing and forbids `docker run`.
  run_auth "$cli" E2E_STANDIN_MISSING_IMAGES="crewrig/e2e-${cli}:latest" E2E_STANDIN_FORBID_RUN=1

  # The script should fail (non-zero) and the error should mention the build
  # hint pointing at `task e2e:build:<cli>`.
  if [[ "$rc" -ne 0 ]] && echo "$out" | grep -qE "e2e:build:${cli}|task e2e:build:${cli}"; then
    note_pass "$s — image-missing precondition fires (rc=$rc, build hint present)"
  else
    note_fail "$s — image-missing precondition fires" \
              "rc=$rc, output=$(printf '%s' "$out" | tr '\n' ' ' | head -c 200)"
  fi
done

# ---------------------------------------------------------------------------
# Guidance-only script: copilot
# ---------------------------------------------------------------------------
run_auth copilot

if [[ "$rc" -eq 0 ]]; then
  note_pass "auth-copilot.sh — exits 0 when only printing guidance"
else
  note_fail "auth-copilot.sh — exits 0 when only printing guidance" "got rc=$rc"
fi

if echo "$out" | grep -q 'github.com/settings/personal-access-tokens/new'; then
  note_pass "auth-copilot.sh — guidance contains PAT-creation URL"
else
  note_fail "auth-copilot.sh — guidance contains PAT-creation URL" "URL not found"
fi

if echo "$out" | grep -q 'export COPILOT_GITHUB_TOKEN'; then
  note_pass "auth-copilot.sh — guidance contains export hint"
else
  note_fail "auth-copilot.sh — guidance contains export hint" "missing export line"
fi

if echo "$out" | grep -qE '90[ -]?DAYS|90[ -]?days'; then
  note_pass "auth-copilot.sh — guidance contains 90-day expiry reminder"
else
  note_fail "auth-copilot.sh — 90-day reminder" "not found in stdout/stderr"
fi

echo ""
echo "Results: $PASS passed, $FAIL failed, $SKIP skipped"
[[ "$FAIL" -eq 0 ]]

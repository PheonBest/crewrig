#!/usr/bin/env bash
# test-e2e-runner-delegation.sh — Regression for the runner→scenario
# delegation contract introduced in ADR 0005 Decision 3.
#
# Verifies that tests/e2e/run.sh:
#   - injects E2E_LIB_DIR and E2E_REPORT_DIR into the scenario script env
#   - resolves the scenario script as tests/e2e/scenarios/<name>/run.sh
#     and delegates to it (observed through a recorder scenario, not by
#     grepping run.sh; the executable-bit gate is checked only while run.sh
#     is a real shell script — spec 0261 R12, R14)
#   - exits 0 in --dry-run with no Docker calls and no auth required
#   - exits 0 in --dry-run --scenario <known-scenario>
#   - exits 0 on --help
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
RUN_SH="${REPO_DIR}/tests/e2e/run.sh"
# Hermetic reports root: run.sh honours E2E_REPORTS_ROOT (spec 0078), so no case
# reads or writes the committed tests/e2e/reports/ directory.
E2E_REPORTS_ROOT="$(mktemp -d)"
export E2E_REPORTS_ROOT
REPORTS="$E2E_REPORTS_ROOT"

# Track every dir created by this test so we leave no debris behind.
#
# Two bash 3.2 (stock macOS) accommodations run throughout this file, both per
# docs/scripting-conventions.md Rule 5:
#   - `while read` rather than `mapfile`, which is a bash 4 builtin;
#   - every array expansion written `${A[@]+"${A[@]}"}`, because bash 3.2 treats
#     an empty array as an unset variable and aborts on it under `set -u`.
pre_dirs=()
while IFS= read -r line || [ -n "$line" ]; do pre_dirs+=("$line"); done \
  < <(find "$REPORTS" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort)
CREATED=()
cleanup() {
  for d in ${CREATED[@]+"${CREATED[@]}"}; do
    [[ -n "$d" && -d "$d" ]] && rm -rf -- "$d"
  done
  [[ -n "${E2E_REPORTS_ROOT:-}" && -d "$E2E_REPORTS_ROOT" ]] && rm -rf -- "$E2E_REPORTS_ROOT"
}
trap cleanup EXIT

# --- Black-box probe harness (spec 0261 R12-R15) ------------------------------
# The runner's behaviour is observed, never its text: a scratch copy of
# tests/e2e/ (with a throwaway recorder as the 01-layered-context scenario
# script) is run with the Docker stand-in first on PATH, a scratch HOME and a
# scratch E2E_REPORTS_ROOT. This holds whether run.sh is today's shell or the
# forwarding shim to run.ts.
SCRATCH="$(mktemp -d)"
STANDIN_BIN="${SCRATCH}/standin-bin"
SCRATCH_TREE="${SCRATCH}/tree"
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
  "${REPO_DIR}/scripts/tests/lib/e2e-docker-standin.ts" --write-launcher "$STANDIN_BIN" >/dev/null 2>&1

build_scratch_tree() {
  mkdir -p "${SCRATCH_TREE}/tests" "${SCRATCH}/home" "${SCRATCH}/e2ehome" "${SCRATCH}/standin-state"
  cp -R "${REPO_DIR}/tests/e2e" "${SCRATCH_TREE}/tests/e2e"
  rm -rf -- "${SCRATCH_TREE}/tests/e2e/reports"
  ln -s "${REPO_DIR}/scripts" "${SCRATCH_TREE}/scripts"
  [[ -e "${REPO_DIR}/node_modules" ]] && ln -s "${REPO_DIR}/node_modules" "${SCRATCH_TREE}/node_modules"
  local rec="${SCRATCH_TREE}/tests/e2e/scenarios/01-layered-context/run.sh"
  cat > "$rec" <<'REC'
#!/usr/bin/env bash
{ for v in E2E_LIB_DIR E2E_REPORT_DIR E2E_CLI E2E_IMAGE E2E_EFFECTIVE_JSON \
           E2E_SCENARIO_DIR E2E_CREDENTIAL_PATH E2E_CREWRIG_E2E_HOME; do
    printf '%s=%s\n' "$v" "${!v-}"
  done; } > "${E2E_REPORT_DIR}/child-env.txt"
exit 0
REC
  chmod +x "$rec"
}

# probe_run <report-dir> [api-key]: run the scratch runner for claude/01-layered-context.
probe_run() {
  local rd="$1" key="${2:-}"
  rm -rf -- "$rd"
  env -u ANTHROPIC_API_KEY -u GEMINI_API_KEY -u COPILOT_GITHUB_TOKEN -u GH_TOKEN \
    ${key:+ANTHROPIC_API_KEY="$key"} \
    HOME="${SCRATCH}/home" CREWRIG_E2E_HOME="${SCRATCH}/e2ehome" \
    E2E_REPORTS_ROOT="${SCRATCH}/reports" \
    PATH="${STANDIN_BIN}:${PATH}" E2E_STANDIN_FORBID_RUN=1 \
    E2E_STANDIN_STATE="${SCRATCH}/standin-state" E2E_STANDIN_LOG="${SCRATCH}/standin.log" \
    bash "${SCRATCH_TREE}/tests/e2e/run.sh" --scenario 01-layered-context --cli claude \
      --report-dir "$rd" 2>&1
}

# child_var <name>: value the scenario child saw in its environment.
child_var() { sed -n "s/^$1=//p" "${CHILD_ENV}" | head -n 1; }
phys() { (cd -P "$1" 2>/dev/null && pwd -P); }

# is_real_shell_script <file>: true only while the file is a real shell script, not a forwarding shim.
is_real_shell_script() {
  local f="$1" first
  [[ "$(wc -l < "$f")" -gt 5 ]] || return 1
  first="$(grep -vE '^[[:space:]]*(#|$)' "$f" | head -n 1)"
  [[ "$first" != exec\ node* ]]
}

trap 'cleanup; rm -rf -- "$SCRATCH"' EXIT

collect_new_dirs() {
  now_dirs=()
  while IFS= read -r line || [ -n "$line" ]; do now_dirs+=("$line"); done \
    < <(find "$REPORTS" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort)
  for d in ${now_dirs[@]+"${now_dirs[@]}"}; do
    known=0
    for p in ${pre_dirs[@]+"${pre_dirs[@]}"} ${CREATED[@]+"${CREATED[@]}"}; do
      [[ "$d" == "$p" ]] && { known=1; break; }
    done
    [[ $known -eq 0 ]] && CREATED+=("$d")
  done
}

# --- 0. Runner present -------------------------------------------------------
if [[ ! -f "$RUN_SH" ]]; then
  note_fail "run.sh exists" "missing at $RUN_SH"
  echo "# $PASS passed / $FAIL failed / $SKIP skipped"
  exit 1
fi
note_pass "run.sh exists"

# --- 1. Runner sets E2E_LIB_DIR and E2E_REPORT_DIR in scenario env ----------
# Behavioural (spec 0261 R12): a recorder scenario script reports the env the
# runner handed it; the assertions hold for the shell runner and the TS port.
build_scratch_tree
RD1="${SCRATCH}/rd1"
CHILD_ENV="${RD1}/claude/01-layered-context/child-env.txt"
out1="$(probe_run "$RD1" "dummy-not-a-real-key")"
lib1="$(child_var E2E_LIB_DIR)"
if [[ -n "$lib1" && "$(phys "$lib1")" == "$(phys "${SCRATCH_TREE}/tests/e2e/lib")" ]]; then
  note_pass "runner — sets E2E_LIB_DIR for scenario script"
else
  note_fail "runner — sets E2E_LIB_DIR" "child saw '${lib1}' out=$(echo "$out1" | tr '\n' '|' | head -c 200)"
fi
rep1="$(child_var E2E_REPORT_DIR)"
if [[ -n "$rep1" && "$(phys "$rep1")" == "$(phys "${RD1}/claude/01-layered-context")" ]]; then
  note_pass "runner — sets E2E_REPORT_DIR for scenario script"
else
  note_fail "runner — sets E2E_REPORT_DIR" "child saw '${rep1}'"
fi

# --- 2. Runner delegates to scenarios/<name>/run.sh -------------------------
# The recorder placed at scenarios/01-layered-context/run.sh was run, with the
# scenario identity in its env, and its exit 0 mapped to `ok`.
sdir1="$(child_var E2E_SCENARIO_DIR)"
if [[ "$(phys "$sdir1")" == "$(phys "${SCRATCH_TREE}/tests/e2e/scenarios/01-layered-context")" ]] \
   && [[ "$(child_var E2E_CLI)" == "claude" ]] && [[ -n "$(child_var E2E_IMAGE)" ]] \
   && grep -q '^ok 1 - claude/01-layered-context$' <<< "$out1"; then
  note_pass "runner — delegates to scenarios/<name>/run.sh (child env + exit 0 → ok)"
else
  note_fail "runner — delegation" "scenario_dir='${sdir1}' cli='$(child_var E2E_CLI)' image='$(child_var E2E_IMAGE)'"
fi
# Spec 0261 requirement 14: the executable bit is runnability of a shell file only, not an oracle for the TS port.
if is_real_shell_script "${REPO_DIR}/tests/e2e/run.sh"; then
  chmod -x "${SCRATCH_TREE}/tests/e2e/scenarios/01-layered-context/run.sh"
  probe_run "${SCRATCH}/rd2" "dummy-not-a-real-key" >/dev/null
  if [[ ! -e "${SCRATCH}/rd2/claude/01-layered-context/child-env.txt" ]]; then
    note_pass "runner — a non-executable scenario script is not delegated to"
  else
    note_fail "runner — delegation gated on executability" "non-executable scenario script was run"
  fi
  chmod +x "${SCRATCH_TREE}/tests/e2e/scenarios/01-layered-context/run.sh"
else
  note_skip "runner — non-executable scenario script not delegated" "run.sh is a forwarding shim (spec 0261 R14)"
fi

# --- 3. --dry-run exits 0 with no auth and no Docker -----------------------
# Force a tmp dir for any auth-home lookup so the runner cannot accidentally
# leak into the real ~/.crewrig-e2e. Unset auth env vars to make sure no
# CLI is treated as "ready" (would still be harmless — dry-run short-
# circuits the docker spawn — but this keeps the assertion sharp).
out3="$(env -u ANTHROPIC_API_KEY -u GEMINI_API_KEY -u COPILOT_GITHUB_TOKEN \
         CREWRIG_E2E_HOME=/tmp/crewrig-test-noop \
         bash "$RUN_SH" --dry-run 2>&1)"
rc3=$?
collect_new_dirs
if [[ $rc3 -eq 0 ]]; then
  note_pass "--dry-run exits 0 with no auth / no docker"
else
  note_fail "--dry-run exits 0" "rc=$rc3 out=$(echo "$out3" | tr '\n' '|' | head -c 240)"
fi

# Sanity: in dry-run mode, the runner must NOT have invoked docker.
# (We can't directly assert "no docker call"; we approximate by checking
# the output never reports a docker exec line.)
if grep -qE '^\+? *docker run ' <<< "$out3"; then
  note_fail "--dry-run does not spawn docker" "found 'docker run' in output"
else
  note_pass "--dry-run does not spawn docker (no 'docker run' in output)"
fi

# --- 4. --help exits 0 ------------------------------------------------------
if bash "$RUN_SH" --help >/dev/null 2>&1; then
  note_pass "--help exits 0"
else
  note_fail "--help exits 0" "non-zero exit"
fi

# --- 5. --dry-run --scenario <known> exits 0 -------------------------------
out5="$(env -u ANTHROPIC_API_KEY -u GEMINI_API_KEY -u COPILOT_GITHUB_TOKEN \
         CREWRIG_E2E_HOME=/tmp/crewrig-test-noop \
         bash "$RUN_SH" --dry-run --scenario 01-layered-context 2>&1)"
rc5=$?
collect_new_dirs
if [[ $rc5 -eq 0 ]]; then
  note_pass "--dry-run --scenario 01-layered-context exits 0"
else
  note_fail "--dry-run --scenario 01-layered-context exits 0" \
            "rc=$rc5 out=$(echo "$out5" | tr '\n' '|' | head -c 240)"
fi

echo ""
echo "# $PASS passed / $FAIL failed / $SKIP skipped"
[[ "$FAIL" -eq 0 ]]

#!/usr/bin/env bash
# test-e2e-auth-claude-json.sh — Regression for GitHub issue #112.
#
# Claude Code persists session state in TWO files:
#   - ~/.claude/.credentials.json   (inside the .claude directory)
#   - ~/.claude.json                (one level ABOVE, in $HOME)
#
# scripts/e2e/auth-claude.sh mounts only `${DIR}:/home/agent/.claude`, so any
# writes Claude makes to `/home/agent/.claude.json` land on the container's
# overlay FS and disappear when the container exits. Subsequent scenario runs
# then have no `.claude.json` to mount and Claude re-prompts for login.
#
# This test locks BOTH ends of the contract:
#   1. scripts/e2e/auth-claude.sh must run docker with a `-v` flag binding
#      `<host>/.claude.json` to `/home/agent/.claude.json`.
#   2. tests/e2e/defaults.toml must include a `mounts` entry mapping the
#      same `.claude.json` for the `[cli.claude]` runtime, so non-interactive
#      scenario runs surface the persisted file inside the container.
#
# Test 1 runs the script against the Docker stand-in (never real docker);
# Test 2 parses the TOML.

set -uo pipefail

PASS=0
FAIL=0

note_pass() { echo "PASS  $1"; PASS=$((PASS + 1)); }
note_fail() { echo "FAIL  $1 — $2"; FAIL=$((FAIL + 1)); }

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AUTH_SCRIPT="${REPO_DIR}/scripts/e2e/auth-claude.sh"
DEFAULTS="${REPO_DIR}/tests/e2e/defaults.toml"

# ---------------------------------------------------------------------------
# Test 1 — auth-claude.sh mounts .claude.json into the container
# ---------------------------------------------------------------------------
if [[ ! -f "$AUTH_SCRIPT" ]]; then
  echo "SKIP  auth-claude.sh not found at $AUTH_SCRIPT — cannot test"
  exit 1
fi

# Black-box (spec 0261 R12): run the script against the Docker stand-in with a
# scratch HOME and read the `-v` binds of the recorded `docker run` argv. Holds
# for the shell script today and for the TypeScript behind the shim later.
STANDIN="${REPO_DIR}/scripts/tests/lib/e2e-docker-standin.ts"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin" "$TMP/fakehome/.claude/rules" "$TMP/state"
echo "rule" > "$TMP/fakehome/.claude/rules/00-test.md"
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON "$STANDIN" --write-launcher "$TMP/bin"
printf '%s' '{"auth/claude":[{"files":{"/home/agent/.claude/.credentials.json":"{}","/home/agent/.claude.json":"{}"}}]}' \
  > "$TMP/fixtures.json"
: > "$TMP/docker.log"

out="$(env HOME="$TMP/fakehome" CREWRIG_E2E_HOME="$TMP/e2e" PATH="$TMP/bin:$PATH" \
  E2E_STANDIN_FIXTURES="$TMP/fixtures.json" E2E_STANDIN_CASE="auth/claude" \
  E2E_STANDIN_STATE="$TMP/state" E2E_STANDIN_LOG="$TMP/docker.log" \
  bash "$AUTH_SCRIPT" </dev/null 2>&1)"
rc=$?

binds="$(jq -r 'select(.argv[0] == "run")
                | .argv as $a
                | range(0; ($a | length) - 1)
                | select($a[.] == "-v") | $a[. + 1]' "$TMP/docker.log" 2>/dev/null)"
want="${TMP}/e2e/.crewrig-e2e/claude/.claude.json:/home/agent/.claude.json"

if [[ "$rc" -eq 0 ]] && grep -Fxq -- "$want" <<< "$binds"; then
  note_pass "auth-claude.sh — docker run binds .claude.json into /home/agent/.claude.json"
else
  note_fail "auth-claude.sh — docker run binds .claude.json into /home/agent/.claude.json" \
    "rc=$rc, expected -v '$want' in docker run argv (issue #112); binds=$(printf '%s' "$binds" | tr '\n' ' ') out=$(printf '%s' "$out" | tr '\n' ' ' | head -c 200)"
fi

# ---------------------------------------------------------------------------
# Test 2 — defaults.toml: [cli.claude].mounts surfaces .claude.json
# ---------------------------------------------------------------------------
if [[ ! -f "$DEFAULTS" ]]; then
  echo "SKIP  defaults.toml not found at $DEFAULTS — cannot test"
  exit 1
fi

if ! command -v yq >/dev/null 2>&1; then
  note_fail "yq dependency" "yq not on PATH — required to parse defaults.toml"
elif ! command -v jq >/dev/null 2>&1; then
  note_fail "jq dependency" "jq not on PATH — required to query the parsed JSON"
else
  JSON="$(yq -p=toml -o=json '.' "$DEFAULTS" 2>/dev/null)" || JSON=""
  if [[ -z "$JSON" ]]; then
    note_fail "defaults.toml parses as TOML" "yq parse error"
  else
    # Any entry in [cli.claude].mounts whose container path is
    # `/home/agent/.claude.json` satisfies the contract. Read-only (`:ro`)
    # suffix is allowed but not required — the runtime composes that.
    if jq -e '
          .cli.claude.mounts // []
          | map(select(test("/home/agent/\\.claude\\.json(:|$)")))
          | length > 0
        ' <<< "$JSON" >/dev/null; then
      note_pass "[cli.claude].mounts — entry targeting /home/agent/.claude.json present"
    else
      got="$(jq -c '.cli.claude.mounts // []' <<< "$JSON")"
      note_fail "[cli.claude].mounts — entry targeting /home/agent/.claude.json present" \
        "no mount for .claude.json found (issue #112). Current mounts=$got"
    fi
  fi
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]

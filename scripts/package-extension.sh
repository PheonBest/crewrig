#!/bin/bash
# package-extension.sh — forwarding shim (spec 0257 R28). The single-extension packager (EXT=<name>) is
# scripts/package-extension.ts; this file remains so every caller that still runs
# `bash scripts/package-extension.sh` (workflows and tasks not yet rewritten, the Bash tests that have not migrated, a
# maintainer's habit) reaches the TypeScript version until the final row removes the shims.
#
# It runs the Node.js floor guard (scripts/lib/node-floor-guard.js), then the TypeScript entry
# with every argument and its standard input, and returns the entry's exit status, standard
# output and standard error unchanged. It fails closed: with `node` absent it writes one
# `Error:` line and exits 1; below the floor it exits with the floor guard's status and
# diagnostic, and the entry is not run, so the filesystem is left unmodified.
#
# Usage: EXT=<name> bash scripts/package-extension.sh

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node was not found on PATH; the single-extension packager needs Node.js 24 or later (https://nodejs.org/en/download)." >&2
  exit 1
fi

node "$DIR/lib/node-floor-guard.js" || exit $?

exec node "$DIR/package-extension.ts" "$@"

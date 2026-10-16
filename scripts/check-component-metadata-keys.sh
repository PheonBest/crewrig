#!/bin/bash
# check-component-metadata-keys.sh — forwarding shim (spec 0259 requirement 21). The check is
# scripts/check-component-metadata-keys.ts; this file remains so every caller that still runs
# `bash scripts/check-component-metadata-keys.sh` reaches the TypeScript version until row J4 removes the shell files.
#
# It runs the Node.js floor guard (scripts/lib/node-floor-guard.js), then the TypeScript entry
# with every argument and its standard input, and returns the entry's exit status, standard
# output and standard error unchanged. It fails closed: with `node` absent it writes one
# `Error:` line and exits 1; below the floor it exits with the floor guard's status and
# diagnostic, and the entry is not run.
#
# Usage: bash scripts/check-component-metadata-keys.sh [<arguments of scripts/check-component-metadata-keys.ts> ...]

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node was not found on PATH; check-component-metadata-keys needs Node.js 24 or later (https://nodejs.org/en/download)." >&2
  exit 1
fi

node "$DIR/lib/node-floor-guard.js" || exit $?

exec node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON "$DIR/check-component-metadata-keys.ts" "$@"

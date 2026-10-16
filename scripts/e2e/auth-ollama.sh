#!/bin/bash
# auth-ollama.sh — forwarding shim (spec 0261 requirements 14, 16, 18). The implementation is
# auth-ollama.ts next to this file; this file remains so every caller that still runs
# `bash scripts/e2e/auth-ollama.sh` reaches it. It runs the Node.js floor guard, then the TypeScript entry with every
# argument and its standard input, and returns its exit status, streams unchanged. It fails
# closed: with `node` absent it writes one `Error:` line and exits 1.

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node was not found on PATH; auth-ollama needs Node.js 24 or later (https://nodejs.org/en/download)." >&2
  exit 1
fi

node "$DIR/../lib/node-floor-guard.js" || exit $?

exec node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON "$DIR/auth-ollama.ts" "$@"

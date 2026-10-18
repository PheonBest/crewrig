// scripts/tls-exec.ts — the runtime trust-propagation wrapper (spec 0084; spec 0266 slice 5b).
//
// Registered as the command prefix of the framework's MCP servers and of the supervised ChromaDB
// daemon: `node <repo>/scripts/tls-exec.ts <command> [args...]`. The implementation is
// scripts/lib/tls-exec/run.ts; it replaces the retired scripts/lib/tls-exec.sh.

import { runTlsExec } from "./lib/tls-exec/run.ts";

runTlsExec(process.argv.slice(2));

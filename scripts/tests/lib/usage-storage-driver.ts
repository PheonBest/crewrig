// usage-storage-driver.ts — the child-process dispatcher of the usage-storage suites
// (spec 0260; replaces the throwaway driver.js of test-usage-storage.sh). It runs as
// `node usage-storage-driver.ts <command> ...` so that each call reads
// CREWRIG_USAGE_ROOT, MEMPALACE_PALACE_PATH and the other variables at import time,
// exactly as a hook-fired write would. USAGE_TEST_REPO_DIR selects the tree whose
// scripts/lib/usage-store modules are loaded (the repository, or a mutated copy).

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const repo = process.env.USAGE_TEST_REPO_DIR;
if (repo === undefined || repo === "") {
  process.stderr.write("FATAL: USAGE_TEST_REPO_DIR not set\n");
  process.exit(2);
}
const require = createRequire(import.meta.url);
interface Store {
  write(rec: unknown): { status: string; reason?: string };
  resolveWing(root?: string): { wing: string; wingDerivation: string };
  tokenPath(): string;
  drainAndSweep(): void;
  readOrRepairSidecar(
    cli: string,
    per: string,
    rid: string,
    rec: unknown,
  ): { wing: string; wingDerivation: string };
  stateDir(): string;
}
const load = (name: string): Store =>
  require(path.join(repo, "scripts", "lib", "usage-store", name)) as Store;

const [, , cmd, a, b, c, d] = process.argv;
switch (cmd) {
  case "write": {
    const result = load("journal.js").write(
      JSON.parse(fs.readFileSync(String(a), "utf8")) as unknown,
    );
    console.log(`STATUS=${result.status}`);
    if (result.reason) console.log(`REASON=${result.reason}`);
    break;
  }
  case "resolve-wing": {
    const info = load("mirror.js").resolveWing(a === "__ABSENT__" ? undefined : String(a));
    console.log(`WING=${info.wing}`);
    console.log(`DERIVATION=${info.wingDerivation}`);
    break;
  }
  case "token-path":
    console.log(load("mcp.js").tokenPath());
    break;
  case "drain-and-sweep":
    load("journal.js").drainAndSweep();
    console.log("DONE");
    break;
  case "repair-sidecar": {
    // args: cli period recordId entryFile
    const record = JSON.parse(fs.readFileSync(String(d), "utf8")) as unknown;
    const info = load("mirror.js").readOrRepairSidecar(String(a), String(b), String(c), record);
    console.log(`WING=${info.wing}`);
    console.log(`DERIVATION=${info.wingDerivation}`);
    break;
  }
  case "state-dir":
    console.log(load("layout.js").stateDir());
    break;
  default:
    console.error(`unknown driver command: ${cmd}`);
    process.exit(2);
}

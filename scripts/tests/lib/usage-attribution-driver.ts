// usage-attribution-driver.ts — the child-process driver of the usage-attribution suites
// (spec 0260, replaces the heredoc Node driver of test-usage-attribution.sh; delta-01 names it
// `.ts`). It loads the still-CommonJS usage libraries from `USAGE_TEST_REPO_DIR` (the checkout,
// or a mutated temp copy) and runs ONE command per process, so no module memo leaks between
// cases. Commands: resolve, submit, capture-throw, period, sha256-file, ledger-append,
// declaration-write. The context protocol is the `ATTR_*` environment of the Bash suite.

import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const REPO_DIR = process.env.USAGE_TEST_REPO_DIR;
if (!REPO_DIR) {
  console.error("FATAL: USAGE_TEST_REPO_DIR not set");
  process.exit(2);
}
const require = createRequire(import.meta.url);
interface Rec {
  recordId: string;
  identity: { projectRoot?: string };
  provenance: { cli: string };
}
interface Ctx {
  now: number;
  cwd: string | undefined;
  declarations: boolean;
  env: Record<string, string>;
  memo: Map<string, unknown>;
}
interface Libs {
  "scripts/lib/usage-capture/attribution": { resolveAttribution(r: Rec, c: Ctx): unknown };
  "scripts/lib/usage-capture/index": {
    submit(r: Rec, c: Ctx): { status: string; reason?: string };
    capture(input: unknown): void;
  };
  "scripts/lib/usage-store/layout": { period(r: unknown): string };
  "scripts/lib/usage-store/ledger": { append(e: unknown): unknown };
  "scripts/lib/usage-store/declaration": { write(o: unknown): unknown };
}
const req = <K extends keyof Libs>(rel: K): Libs[K] => require(path.join(REPO_DIR, rel)) as Libs[K];
const argv = process.argv;

function loadRecord(file: string): Rec {
  const rec = JSON.parse(fs.readFileSync(file, "utf8")) as Rec;
  if (process.env.ATTR_PROJECT_ROOT_OVERRIDE !== undefined) {
    rec.identity.projectRoot = process.env.ATTR_PROJECT_ROOT_OVERRIDE;
  }
  return rec;
}

function ctxFromEnv() {
  const env: Record<string, string> = {};
  const task = process.env.ATTR_CTX_ENV_CREWRIG_TASK;
  const hosts = process.env.ATTR_CTX_ENV_FORGE_HOSTS;
  if (task !== undefined) env.CREWRIG_TASK = task;
  if (hosts !== undefined) env.CREWRIG_FORGE_HOSTS = hosts;
  return {
    now: process.env.ATTR_CTX_NOW ? Number(process.env.ATTR_CTX_NOW) : Date.now(),
    cwd: process.env.ATTR_CTX_CWD || undefined,
    declarations: process.env.ATTR_CTX_DECLARATIONS !== "0",
    env,
    memo: new Map(),
  };
}

const commands: Record<string, () => void> = {
  resolve() {
    const attribution = req("scripts/lib/usage-capture/attribution");
    console.log(JSON.stringify(attribution.resolveAttribution(loadRecord(argv[3]), ctxFromEnv())));
  },
  submit() {
    const rec = loadRecord(argv[3]);
    const result = req("scripts/lib/usage-capture/index").submit(rec, ctxFromEnv());
    const layout = req("scripts/lib/usage-store/layout");
    console.log(
      JSON.stringify({
        status: result.status,
        reason: result.reason || null,
        recordId: rec.recordId,
        cli: rec.provenance.cli,
        period: layout.period(rec),
      }),
    );
  },
  "capture-throw"() {
    const index = req("scripts/lib/usage-capture/index");
    index.capture({
      cli: argv[3],
      event: "test-throw",
      payload: { transcript_path: argv[4], cwd: argv[5] },
    });
    console.log("DONE");
  },
  period() {
    const rec: unknown = JSON.parse(fs.readFileSync(argv[3], "utf8"));
    console.log(req("scripts/lib/usage-store/layout").period(rec));
  },
  "sha256-file"() {
    console.log(crypto.createHash("sha256").update(fs.readFileSync(argv[3])).digest("hex"));
  },
  "ledger-append"() {
    console.log(JSON.stringify(req("scripts/lib/usage-store/ledger").append(JSON.parse(argv[3]))));
  },
  "declaration-write"() {
    console.log(
      JSON.stringify(req("scripts/lib/usage-store/declaration").write(JSON.parse(argv[3]))),
    );
  },
};

const run = commands[argv[2] ?? ""];
if (run === undefined) {
  console.error(`unknown driver command: ${argv[2]}`);
  process.exit(2);
}
run();

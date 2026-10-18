// usage-attribution-prune-rig.ts — shared by the prune and mutation suites of the usage-attribution
// port (spec 0260, test-usage-attribution.sh L858-1234). The Bash suite patched the tracked
// `layout.js` in place to register a synthetic cli-period store `test-store`; here the patch goes
// on a temp COPY of the usage libraries and the entries run against that copy.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { applyMutation, copyLibTree } from "./usage-mutants.ts";
import type { MutationCopy } from "./mutation-copy.ts";
import {
  type Case,
  driver,
  fixture,
  journalPath,
  newCase,
  realTmp,
  recordId,
} from "./usage-attribution-rig.ts";

export const PRUNE_CLI = "claude-code";
export const PRUNE_PERIOD = "2024-08";
export const LAYOUT = "scripts/lib/usage-store/layout.js";
const MARKER = "  ];\n}\n\n// --- Mirror";
const ADDITION = [
  "    {",
  '      id: "test-store",',
  '      scope: "cli-period",',
  '      dirFor: (cli, per) => path.join(resolveRoot(), "test-cli-period-store", cli, per),',
  "      isEntry: (name) => /^test-entry-.*\\.json$/.test(name),",
  "    },",
  "  ];",
  "}",
  "",
  "// --- Mirror",
].join("\n");

/** A temp copy of the usage-store tree plus `usage-capture` (the driver loads both). */
export const attributionCopy = (): MutationCopy => copyLibTree(["scripts/lib/usage-capture"]);

/** Register the synthetic `test-store` in the copy's `layout.js` (throws if the marker is gone). */
export function registerTestStore(copy: MutationCopy): void {
  applyMutation(copy, LAYOUT, MARKER, ADDITION);
}

/** Case whose driver loads the libraries of `copy` instead of the checkout. */
export const copyCase = (copy: MutationCopy): Case => newCase({ USAGE_TEST_REPO_DIR: copy.root });

export interface PruneSeed {
  readonly entry: string;
  readonly attr: string;
  readonly partition: string;
}

/** Submit the prune record, append a ledger entry for its period, populate the `test-store`. */
export function seedPrune(c: Case, cwd: string, ledgerReason: string): PruneSeed {
  const sub = driver(c, ["submit", fixture("prune-main-record.json")], {
    ATTR_CTX_CWD: cwd,
    ATTR_CTX_ENV_CREWRIG_TASK: "attr-prune-key",
  });
  if (!sub.stdout.includes('"status":"stored"')) {
    throw new Error(`prune main record did not store: ${sub.stdout}${sub.stderr}`);
  }
  const ledger = driver(c, [
    "ledger-append",
    JSON.stringify({
      scope: { session: "attr-prune-session" },
      timestamp: "2024-08-20T00:00:00.000Z",
      author: "test-suite",
      reason: ledgerReason,
      taskHandoffKey: "prune-ledger-key",
    }),
  ]);
  if (ledger.status !== 0) throw new Error(`ledger-append failed: ${ledger.stderr}`);
  const partition = path.join(c.root, "test-cli-period-store", PRUNE_CLI, PRUNE_PERIOD);
  fs.mkdirSync(partition, { recursive: true });
  fs.writeFileSync(path.join(partition, "test-entry-1.json"), '{"probe":true}\n');
  const rid = recordId(fixture("prune-main-record.json"));
  return {
    entry: journalPath(c.root, PRUNE_CLI, PRUNE_PERIOD, rid),
    attr: journalPath(c.root, PRUNE_CLI, PRUNE_PERIOD, rid, ".attr"),
    partition,
  };
}

const NO_GIT = realTmp("usage-attr-nogit-");

/** Run `body` on a fresh copy mutated at `file`; the copy is always disposed. */
export function withMutant<T>(
  file: string,
  needle: string | RegExp,
  replacement: string,
  body: (copy: MutationCopy, c: Case) => T,
  prepare: (copy: MutationCopy) => void = () => {},
): T {
  const copy = attributionCopy();
  try {
    prepare(copy);
    applyMutation(copy, file, needle, replacement);
    return body(copy, copyCase(copy));
  } finally {
    copy.dispose();
  }
}

export function resolve(
  c: Case,
  rec: string,
  cwd: string,
  extra: Record<string, string | undefined> = {},
) {
  const out = driver(c, ["resolve", fixture(rec)], { ATTR_CTX_CWD: cwd, ...extra });
  assert.equal(out.status, 0, out.stderr);
  return out.stdout;
}

export function submit(c: Case, rec: string, extra: Record<string, string | undefined> = {}) {
  const out = driver(c, ["submit", fixture(`${rec}.json`)], { ATTR_CTX_CWD: NO_GIT, ...extra });
  assert.match(out.stdout, /"status":"stored"/, `${rec}: ${out.stdout}${out.stderr}`);
  return JSON.parse(out.stdout) as { period: string; cli: string; recordId: string };
}

export const specFile = (dir: string, name: string, related: number, id: string, slug: string) => {
  fs.mkdirSync(path.join(dir, "specs"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "specs", `${name}.md`),
    `---\nid: "${id}"\nslug: ${slug}\nstatus: implemented\ncomplexity: small\ninteraction-mode: MINIMAL\nrelated-issue: ${related}\nversion: 1.0.0\n---\n\n# ${slug}\n`,
  );
};

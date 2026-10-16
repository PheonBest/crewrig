// e2e-record.ts — record (or check) the goldens of the end-to-end harness oracle (spec 0261 R5,
// R7, R8).
//
//   node scripts/tests/lib/e2e-record.ts --out <dir> [--case <id-prefix>] [--check]
//
// Every selected case of the registry runs through the SHELL subject (`bash tests/e2e/run.sh`,
// forced: the recording is the reference) and lands in
// `<dir>/<scenario>/<cli>/<variant>/tuple.json.golden` (2-space JSON, stable key order, trailing
// LF). With --check nothing is written: a missing or differing golden is reported and the exit is 1.
//
// Normaliser contract (e2e-normalise.ts): the node path becomes <NODE>, the scratch tree <TMP>,
// the e2e bundle root <E2E_HOME>, the scratch HOME <HOME>, container names <CONTAINER>, run ids
// <RUN_ID>, ISO timestamps <TS>, URL ports <PORT>. Nothing else is rewritten: a leak of a host
// path or a version string into a golden is a defect of the case, not something to mask.
//
// Recording procedure (PLAN v3): run the recorder in two different images (e.g. the Linux
// container image and a second distribution) and require identical goldens before committing
// them; a difference means the tuple leaks the environment. The recording needs bash >= 4, jq and
// yq (see shellPrerequisites). Goldens are never regenerated from the TypeScript side: a port that
// disagrees with a golden is wrong, the golden is the oracle.

import fs from "node:fs";
import path from "node:path";

import { cases } from "./e2e-oracle-cases.ts";
import { goldenPath, observe, serialise, shellPrerequisites } from "./e2e-oracle-observe.ts";

export function main(argv: readonly string[]): number {
  let out = "";
  let prefix = "";
  let check = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out") out = argv[++i] ?? "";
    else if (arg === "--case") prefix = argv[++i] ?? "";
    else if (arg === "--check") check = true;
    else {
      process.stderr.write(`e2e-record: unknown argument ${String(arg)}\n`);
      return 2;
    }
  }
  if (out === "") {
    process.stderr.write("usage: e2e-record.ts --out <dir> [--case <id-prefix>] [--check]\n");
    return 2;
  }
  const skip = shellPrerequisites();
  if (skip !== null) {
    process.stderr.write(`e2e-record: cannot record: ${skip}\n`);
    return 2;
  }
  let bad = 0;
  for (const c of cases.filter((x) => x.id.startsWith(prefix))) {
    const text = serialise(observe(c, "shell"));
    const file = goldenPath(out, c);
    if (check) {
      const have = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
      if (have !== text) {
        bad++;
        process.stdout.write(`${have === undefined ? "MISSING" : "DIFF"} ${c.id}\n`);
      }
    } else {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
      process.stdout.write(`recorded ${c.id}\n`);
    }
  }
  return bad === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename) {
  process.exitCode = main(process.argv.slice(2));
}

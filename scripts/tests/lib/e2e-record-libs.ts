// e2e-record-libs.ts — record, or check, the golden Tuples of the library cases (spec 0261 R9).
//
//   node scripts/tests/lib/e2e-record-libs.ts --out <dir> [--case <id-prefix>] [--check]
//
// Writes `<dir>/<id>/tuple.json.golden` for every case (or those whose id starts with the prefix),
// observed from the unchanged SHELL libraries: sorted keys, 2-space JSON, LF, final newline.
// With `--check` nothing is written; the exit code is 1 when a golden is missing or differs.
//
// Recording procedure (two images, because a golden must not depend on one environment): run this
// command inside the Linux e2e image (bash >= 4, GNU grep, jq, git), commit the goldens, then run
// it again with `--check` in a second image built from another base; any difference is an
// environment leak to fix in the normaliser, not to paper over. Goldens are never regenerated from
// TypeScript: the TypeScript twin is replayed against them and must match without `--out` writes.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { cases } from "./e2e-oracle-libs-cases.ts";
import { observeLib, shellLibPrerequisites } from "./e2e-oracle-libs-observe.ts";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

function sorted(v: Json): Json {
  if (Array.isArray(v)) return v.map(sorted);
  if (v !== null && typeof v === "object") {
    const out: { [k: string]: Json } = {};
    for (const k of Object.keys(v).sort()) out[k] = sorted(v[k] as Json);
    return out;
  }
  return v;
}

export function goldenText(tuple: unknown): string {
  return `${JSON.stringify(sorted(tuple as Json), null, 2)}\n`;
}

function parseArgs(argv: readonly string[]): { out: string; prefix: string; check: boolean } {
  let out = "";
  let prefix = "";
  let check = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") out = argv[++i] ?? "";
    else if (argv[i] === "--case") prefix = argv[++i] ?? "";
    else if (argv[i] === "--check") check = true;
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (out === "") throw new Error("--out <dir> is required");
  return { out: path.resolve(out), prefix, check };
}

function main(): number {
  const { out, prefix, check } = parseArgs(process.argv.slice(2));
  const reason = shellLibPrerequisites();
  if (reason !== null) {
    process.stderr.write(`cannot record: ${reason}\n`);
    return 2;
  }
  let bad = 0;
  for (const c of cases.filter((x) => x.id.startsWith(prefix))) {
    const missing = shellLibPrerequisites(c.tools ?? []);
    if (missing !== null) {
      process.stderr.write(`skip ${c.id}: ${missing}\n`);
      bad++;
      continue;
    }
    const file = path.join(out, c.id, "tuple.json.golden");
    const text = goldenText(observeLib(c));
    if (check) {
      const have = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
      if (have !== text) {
        process.stderr.write(`${have === null ? "missing" : "differs"}: ${c.id}\n`);
        bad++;
      }
    } else {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
    }
  }
  return bad === 0 ? 0 : 1;
}

if (import.meta.main) process.exitCode = main();

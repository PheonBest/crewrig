// e2e-record-judge.ts — record the shell judge's tuples against the HTTP stand-in (spec 0261 R9).
//   node scripts/tests/lib/e2e-record-judge.ts --out <dir> [--case <id-prefix>] [--check]
// Writes <dir>/<id>/tuple.json.golden; with --check it compares instead of writing. Exits 1 when a
// case misses its declared expected shape or (with --check) differs from its golden.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkExpect, runCase, toolAvailable } from "./e2e-judge-run.ts";
import { JUDGE_CASES } from "./e2e-oracle-judge-cases.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<number> {
  const out = arg("--out");
  if (out === undefined) {
    process.stderr.write("usage: e2e-record-judge.ts --out <dir> [--case <id-prefix>] [--check]\n");
    return 2;
  }
  const bash = process.env["E2E_BASH"] ?? "bash";
  const avail = await toolAvailable(bash);
  if (!avail.ok) {
    process.stderr.write(`cannot record: ${avail.reason}\n`);
    return 2;
  }
  const check = process.argv.includes("--check");
  const prefix = arg("--case") ?? "";
  let failures = 0;
  for (const c of JUDGE_CASES.filter((x) => x.id.startsWith(prefix))) {
    if (c.posixOnly === true && process.platform === "win32") continue;
    const tuple = await runCase(c, repoRoot, bash);
    const bad = checkExpect(c, tuple);
    const file = path.join(out, c.id, "tuple.json.golden");
    const text = `${JSON.stringify(tuple, null, 2)}\n`;
    if (check) {
      const same = fs.existsSync(file) && fs.readFileSync(file, "utf8") === text;
      if (!same) bad.push("differs from golden");
    } else if (bad.length === 0) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
    }
    if (bad.length > 0) failures++;
    process.stdout.write(
      `${bad.length === 0 ? "ok  " : "FAIL"} ${c.id}${bad.length ? ` — ${bad.join("; ")}` : ""}\n`,
    );
  }
  return failures === 0 ? 0 : 1;
}

process.exitCode = await main();

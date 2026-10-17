// usage-capture-optin-recognition.test.ts — the SHIPPED recognition predicate against the shared corpus
// (spec 0263, row J1b; closes the weakness of G32 in usage-capture-optin-fragments.test.ts, which only
// exercises the test-owned oracle). Each corpus row is written into a scratch configuration of the CLI
// the command names, and `usage-capture-optin.ts state` must report `installed` exactly when the row's
// `capture` flag is true and `absent` otherwise. A mutation of scripts/lib/hook-recognition.ts turns it red.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";

import { CORPUS, runOptin, scratch } from "./lib/optin-fixtures.ts";
import { isObj, readJson, type Json, type OptinCli } from "./lib/optin-oracle.ts";

const s = scratch();
after(() => s.cleanup());

const cliOf = (command: string): OptinCli =>
  /\bgemini-cli\b/.test(command)
    ? "gemini"
    : /\bcopilot-cli\b/.test(command)
      ? "copilot"
      : "claude";

function configOf(cli: OptinCli, command: string): Json {
  const handler: Json = { type: "command", command };
  const hooks = { Stop: [cli === "copilot" ? handler : { hooks: [handler] }] };
  return cli === "copilot" ? { version: 1, hooks } : { hooks };
}

describe("the shipped entry agrees with the recognition corpus", () => {
  const rows = readJson(CORPUS);
  it("the corpus is not vacuous (at least 30 rows, both verdicts present)", () => {
    assert.ok(Array.isArray(rows) && rows.length >= 30, "row count floor");
    const flags = new Set(rows.map((r) => (isObj(r) ? r["capture"] : undefined)));
    assert.deepEqual([...flags].sort(), [false, true]);
  });
  it("state is `installed` for every capture row and `absent` for every other row", () => {
    assert.ok(Array.isArray(rows));
    let checked = 0;
    for (const [i, row] of rows.entries()) {
      assert.ok(isObj(row) && typeof row["command"] === "string");
      const cli = cliOf(row["command"]);
      const cfg = path.join(s.tmp, "corpus", `${i}.json`);
      fs.mkdirSync(path.dirname(cfg), { recursive: true });
      fs.writeFileSync(cfg, JSON.stringify(configOf(cli, row["command"])));
      const r = runOptin("state", [cli, cfg], { env: s.env });
      assert.equal(r.status, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        row["capture"] === true ? "installed" : "absent",
        `${row["command"]} (${String(row["note"])})`,
      );
      checked += 1;
    }
    assert.equal(checked, rows.length);
  });
});

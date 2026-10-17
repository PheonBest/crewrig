// usage-capture-optin-node-floor.test.ts — below the Node.js floor nothing is written (spec 0263, row J1b;
// port of section 6 (d) of test-setup-usage-capture-optin.sh: group G37). The Bash shim ran the entry as
// `node -r scripts/lib/node-floor-guard.js entry`; so does this file, on the real node with a preload
// that makes `process.version` read v20.19.5. setup-lib-usage-entry-form.test.ts already covers the
// `enable`/`fragment` legs; this file ports the apply, disclose and remove legs. The shim's own
// "Node.js was not found on PATH" message (usage_capture_require_node_floor) is a Bash-shim behaviour
// with no counterpart in the entry, and is not ported.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";

import { materialize, REPO, scratch, type Scratch } from "./lib/optin-fixtures.ts";
import { backups, OPTIN_CLIS, totalCapture, readJson, type OptinCli } from "./lib/optin-oracle.ts";
import { ENTRY } from "./lib/usage-entry-rig.ts";

const POSIX = process.platform === "win32" ? "POSIX-only: the leg mirrors the POSIX shim" : false;
const GUARD = path.join(REPO, "scripts", "lib", "node-floor-guard.js");
const roots: Scratch[] = [];
after(() => roots.forEach((r) => r.cleanup()));

function run(s: Scratch, withGuard: boolean, args: readonly string[]) {
  const preload = path.join(s.tmp, "version.js");
  fs.writeFileSync(preload, 'Object.defineProperty(process, "version", { value: "v20.19.5" });\n');
  const pre = ["--require", preload, ...(withGuard ? ["--require", GUARD] : [])];
  const r = spawnSync(process.execPath, [...pre, ENTRY, ...args], {
    encoding: "utf8",
    env: s.env,
    cwd: REPO,
    input: "",
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}
const fresh = (): Scratch => {
  const s = scratch();
  roots.push(s);
  return s;
};

describe("G37 below the Node.js floor (v20.19.5)", { skip: POSIX }, () => {
  for (const cli of OPTIN_CLIS as readonly OptinCli[]) {
    it(`${cli}: installed + keep leaves the legacy command, no backup, names 20 and 24`, () => {
      const s = fresh();
      const cfg = path.join(s.tmp, "low", "config.json");
      materialize(`${cli}-coupled.json`, cfg, s.home);
      const before = fs.readFileSync(cfg, "utf8");
      const r = run(s, true, ["apply", "--", cli, cfg, REPO, "installed", "keep"]);
      assert.notEqual(r.status, 0);
      assert.equal(fs.readFileSync(cfg, "utf8"), before);
      assert.deepEqual(backups(cfg), []);
      assert.match(r.out, /20\.19\.5/);
      assert.match(r.out, /requires Node\.js >= 24/);
    });
    it(`${cli}: absent disclose prints the guard's diagnostic, not a raw Node.js error`, () => {
      const s = fresh();
      const cfg = path.join(s.tmp, "low-absent", "config.json");
      const r = run(s, true, ["disclose", "--", cli, cfg, REPO]);
      assert.notEqual(r.status, 0);
      assert.match(r.out, /requires Node\.js >= 24/);
      assert.doesNotMatch(r.out, /ERR_/);
      assert.doesNotMatch(r.out, /Enabling usage capture/);
    });
    it(`${cli}: absent + yes does not enable capture and creates nothing`, () => {
      const s = fresh();
      const cfg = path.join(s.tmp, "low-yes", "config.json");
      const r = run(s, true, ["apply", "--", cli, cfg, REPO, "absent", "yes"]);
      assert.notEqual(r.status, 0);
      assert.equal(fs.existsSync(cfg), false);
      assert.match(r.out, /requires Node\.js >= 24/);
    });
    it(`${cli}: remove still works, it never depends on the floor guard`, () => {
      const s = fresh();
      const cfg = path.join(s.tmp, "low-remove", "config.json");
      materialize(`${cli}-coupled.json`, cfg, s.home);
      assert.ok(totalCapture(readJson(cfg)) > 0, "the fixture carries capture");
      const r = run(s, false, ["apply", "--", cli, cfg, REPO, "installed", "remove"]);
      assert.equal(r.status, 0, r.out);
      assert.equal(totalCapture(readJson(cfg)), 0);
    });
  }
});

// usage-capture-optin-keep-paths.test.ts — what `keep` does with unexpanded, legacy-coupled and
// duplicated capture paths (spec 0263, row J1b; port of §3 (p'), (p''), (s) of
// test-setup-usage-capture-optin.sh: groups G23, G24, G27). Companion of usage-capture-optin-keep.test.ts.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  addCmds,
  CAPTURE_SH_ABS,
  emptyGroups,
  initCfg,
  materialize,
  REPO,
  runOptin,
  scratch,
} from "./lib/optin-fixtures.ts";
import {
  assertOnceAt,
  both,
  firstEvent,
  run,
  same,
  stateOf,
  usageCaptureStub,
  writeJson,
} from "./lib/optin-keepkit.ts";
import {
  backups,
  captureCount,
  cliEvents,
  cliTag,
  isObj,
  OPTIN_CLIS,
  readJson,
  type Json,
} from "./lib/optin-oracle.ts";

describe("G23 keep never re-points an unexpanded path (S2)", () => {
  const forms: ReadonlyArray<readonly [string, (cli: string, ev: string) => string]> = [
    ["home", (t, e) => 'bash "$HOME/tools/hooks/usage-capture.sh" ' + `${t} ${e}`],
    ["brace", (t, e) => 'bash "${CLAUDE_PROJECT_DIR}/hooks/usage-capture.sh" ' + `${t} ${e}`],
    ["tilde", (t, e) => `bash ~/tools/hooks/usage-capture.sh ${t} ${e}`],
  ];
  for (const cli of OPTIN_CLIS)
    for (const [form, cmd] of forms)
      it(`${cli}: the ${form}-form reads as capture and keep leaves it byte-unchanged`, () => {
        const s = scratch();
        try {
          const cfg = path.join(s.tmp, "pp", `${cli}-${form}`, "config.json");
          const doc = initCfg(cli);
          writeJson(cfg, doc);
          const hooks = isObj(doc) ? doc["hooks"] : undefined;
          assert.ok(isObj(hooks));
          for (const ev of cliEvents(cli)) {
            const h: Json = { type: "command", command: cmd(cliTag(cli), ev) };
            hooks[ev] = [cli === "copilot" ? h : { hooks: [h] }];
          }
          writeJson(cfg, doc);
          const orig = `${cfg}.orig`;
          fs.copyFileSync(cfg, orig);
          assert.equal(stateOf(s, cli, cfg), "installed");
          const r = run(s, "keep", cli, cfg, REPO);
          assert.equal(r.status, 0, both(r));
          assert.ok(same(cfg, orig));
          assert.doesNotMatch(both(r), /re-pointed/);
          assert.equal(backups(cfg).length, 0);
        } finally {
          s.cleanup();
        }
      });
});

describe("G24 the origin/main coupled forms are still recognised (S2)", () => {
  for (const cli of OPTIN_CLIS)
    it(`${cli}: one capture handler per R5 event at ${path.basename(CAPTURE_SH_ABS)}`, () => {
      const s = scratch();
      try {
        const cfg = path.join(s.tmp, "ppp", cli, "config.json");
        materialize(`${cli}-coupled.json`, cfg, s.home);
        const fp = runOptin("footprint", [cli, cfg], { env: s.env });
        const list: unknown = JSON.parse(fp.stdout);
        assert.ok(Array.isArray(list));
        assert.equal(list.length, cliEvents(cli).length);
        assert.equal(runOptin("paths", [cli, cfg], { env: s.env }).stdout.trim(), CAPTURE_SH_ABS);
      } finally {
        s.cleanup();
      }
    });
});

describe("G27 keep on a duplicated event keeps the live command (i1-F6)", () => {
  for (const cli of OPTIN_CLIS)
    it(`${cli}: one checkout remains, the live one, no empty matcher group`, () => {
      const s = scratch();
      try {
        const live = usageCaptureStub(path.join(s.tmp, "s", "other-checkout"));
        const gone = path.join(s.tmp, "s", "gone-checkout", "hooks", "usage-capture.sh");
        const cfg = path.join(s.tmp, "s", cli, "config.json");
        const doc = initCfg(cli);
        const ev0 = firstEvent(cli);
        const one = initCfg(cli);
        addCmds(one, cli, gone);
        addCmds(doc, cli, live);
        const [gHooks, dHooks] = [
          isObj(one) ? one["hooks"] : null,
          isObj(doc) ? doc["hooks"] : null,
        ];
        assert.ok(isObj(gHooks) && isObj(dHooks));
        const goneEntry = gHooks[ev0];
        const liveEntries = dHooks[ev0];
        assert.ok(Array.isArray(goneEntry) && Array.isArray(liveEntries));
        dHooks[ev0] = [...goneEntry, ...liveEntries];
        writeJson(cfg, doc);
        assert.equal(captureCount(readJson(cfg), ev0), 2);
        const r = run(s, "keep", cli, cfg, REPO);
        assert.equal(r.status, 0, both(r));
        assertOnceAt(cli, cfg, live);
        assert.equal(runOptin("paths", [cli, cfg], { env: s.env }).stdout.trim(), live);
        assert.doesNotMatch(both(r), /re-pointed/);
        assert.equal(emptyGroups(readJson(cfg)), 0);
      } finally {
        s.cleanup();
      }
    });
});

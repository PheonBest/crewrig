// usage-capture-optin-merge.test.ts — the session-recording merge preserves capture and operator
// hooks (spec 0263, row J1b; port of sections 3 (d), (d') and (d'') of
// test-setup-usage-capture-optin.sh: groups G7, G8, G9). Calls scripts/usage-capture-optin.ts
// through runOptin; the oracle is optin-oracle.ts.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  addCmds,
  initCfg,
  materialize,
  mergeSr,
  patchedManifest,
  scratch,
} from "./lib/optin-fixtures.ts";
import { assertCaptureOnceAt } from "./lib/optin-merge-remove.ts";
import {
  backups,
  canonical,
  handlers,
  isObj,
  jsonEq,
  noncaptureView,
  operatorHandlers,
  OPTIN_CLIS,
  readJson,
  sessionRecordingHandlers,
  type Json,
  type OptinCli,
} from "./lib/optin-oracle.ts";

const write = (file: string, doc: Json): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
};
const hooksView = (file: string): string => {
  const cfg = readJson(file);
  return noncaptureView(isObj(cfg) && isObj(cfg["hooks"]) ? { hooks: cfg["hooks"] } : cfg);
};

describe("G7 the merge preserves capture (R8)", () => {
  for (const cli of OPTIN_CLIS) {
    it(`${cli}: over a capture-only install naming another checkout, two merges keep it once, in place`, (t) => {
      const s = scratch();
      t.after(s.cleanup);
      const patched = path.join(s.tmp, `${cli}-patched.json`);
      patchedManifest(cli, patched, s.home);
      const other = path.join(s.tmp, "other-checkout", "hooks", "usage-capture.ts");
      const cfg = path.join(s.tmp, cli, "config.json");
      const doc = initCfg(cli);
      addCmds(doc, cli, other);
      write(cfg, doc);
      const r1 = mergeSr(s, cli, cfg, patched);
      const first = fs.readFileSync(cfg, "utf8");
      const r2 = mergeSr(s, cli, cfg, patched);
      assert.deepEqual([r1.status, r2.status], [0, 0], r1.stderr + r2.stderr);
      assertCaptureOnceAt(readJson(cfg), cli, other);
      assert.equal(hooksView(cfg), hooksView(patched), "session-recording and guard entries added");
      assert.equal(fs.readFileSync(cfg, "utf8"), first, "a second merge changes nothing");
      if (cli === "claude") {
        const env = (readJson(cfg) as { env?: Record<string, string> }).env;
        assert.equal(env?.["MEMPALACE_TRANSCRIPT_ENABLED"], "1", "env patch applied");
      }
    });
    it(`${cli}: two merges over a coupled install leave it unchanged and back it up`, (t) => {
      const s = scratch();
      t.after(s.cleanup);
      const patched = path.join(s.tmp, `${cli}-patched.json`);
      patchedManifest(cli, patched, s.home);
      const cfg = path.join(s.tmp, `${cli}-coupled`, "config.json");
      materialize(`${cli}-coupled.json`, cfg, s.home);
      mergeSr(s, cli, cfg, patched);
      mergeSr(s, cli, cfg, patched);
      const orig = path.join(s.tmp, "orig.json");
      materialize(`${cli}-coupled.json`, orig, s.home);
      assert.ok(jsonEq(cfg, orig), `changed: ${canonical(readJson(cfg))}`);
      assert.ok(backups(cfg).length > 0, "the merge took a backup first");
    });
  }
});

describe("G8 an operator hook on the same event survives (#1234)", () => {
  for (const cli of ["claude", "gemini"] as const satisfies readonly OptinCli[]) {
    it(`${cli}: operator handlers unchanged, every manifest handler added, second merge a fixed point`, (t) => {
      const s = scratch();
      t.after(s.cleanup);
      const patched = path.join(s.tmp, `${cli}-patched.json`);
      patchedManifest(cli, patched, s.home);
      const cfg = path.join(s.tmp, cli, "config.json");
      materialize(`${cli}-operator-stripped.json`, cfg, s.home);
      const before = operatorHandlers(readJson(cfg));
      assert.notEqual(before, "[]", "the fixture carries an operator hook (/opt/operator/)");
      const r1 = mergeSr(s, cli, cfg, patched);
      assert.equal(r1.status, 0, r1.stderr);
      assert.equal(operatorHandlers(readJson(cfg)), before, "operator hooks lost or changed");
      const want = canonical(
        handlers(readJson(patched))
          .map(({ e, s: sel, h }): Json => (sel === undefined ? { e, h } : { e, s: sel, h }))
          .map((x) => canonical(x))
          .sort(),
      );
      const after1 = sessionRecordingHandlers(readJson(cfg));
      assert.notEqual(want, "[]");
      assert.equal(after1, want, "session-recording handlers match the manifest");
      const r2 = mergeSr(s, cli, cfg, patched);
      assert.equal(r2.status, 0, r2.stderr);
      assert.equal(operatorHandlers(readJson(cfg)), before);
      assert.equal(sessionRecordingHandlers(readJson(cfg)), after1, "no duplicated handler");
    });
  }
});

describe("G9 a compound command chaining a framework script is not owned", () => {
  const compounds = {
    leading:
      "/opt/operator/bin/pre-check.sh && bash /opt/other-checkout/hooks/mempalace-transcript.sh",
    trailing:
      "bash /opt/other-checkout/hooks/mempalace-transcript.sh && /opt/operator/bin/post-check.sh",
  } as const;
  for (const cli of ["claude", "gemini"] as const) {
    for (const [order, compound] of Object.entries(compounds)) {
      it(`${cli}: the ${order} compound survives the merge unstripped, once`, (t) => {
        const s = scratch();
        t.after(s.cleanup);
        const patched = path.join(s.tmp, "patched.json");
        patchedManifest(cli, patched, s.home);
        const cfg = path.join(s.tmp, "config.json");
        const handler = { type: "command", command: compound };
        write(
          cfg,
          cli === "claude"
            ? { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [handler] }] } }
            : {
                hooks: {
                  BeforeTool: [{ hooks: [{ ...handler, name: "operator-compound" }] }],
                },
              },
        );
        const r = mergeSr(s, cli, cfg, patched);
        assert.equal(r.status, 0, r.stderr);
        const n = handlers(readJson(cfg)).filter((x) => isObj(x.h) && x.h["command"] === compound);
        assert.equal(n.length, 1, canonical(readJson(cfg)));
      });
    }
  }
});

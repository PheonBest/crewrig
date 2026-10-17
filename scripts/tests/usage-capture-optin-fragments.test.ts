// usage-capture-optin-fragments.test.ts — the capture fragments and the declared shape of the
// session-recording and usage-capture steps (spec 0263, row J1b; port of sections 1, 2, 4 and 5 of
// test-setup-usage-capture-optin.sh: groups G1, G2, G30, G31 antigravity half, G32 non-vacuity).
// The order and prompt-id facts are also pinned by setup-retarget-usage-order.test.ts; the option
// lists, headers and hooks.src live only here. The oracle is optin-oracle.ts (independent of the
// implementation).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  CAPTURE_ABS,
  CAPTURE_SH_ABS,
  CORPUS,
  declOf,
  FIX_DIR,
  materialize,
  REPO,
  runOptin,
  scratch,
  stepNo,
} from "./lib/optin-fixtures.ts";
import {
  captureCmds,
  cliEvents,
  cliTag,
  expectedCmd,
  handlers,
  isCapture,
  isObj,
  legacyCmd,
  OPTIN_CLIS,
  readJson,
  sortedEvents,
  type Json,
} from "./lib/optin-oracle.ts";

const frag = (cli: string): string => path.join(REPO, "hooks", `${cli}-usage-capture-hooks.json`);

describe("G1 the capture fragments (R3, R5)", () => {
  for (const cli of OPTIN_CLIS) {
    const s = scratch();
    const cfg = readJson(frag(cli));
    const hooks = isObj(cfg) ? cfg["hooks"] : undefined;
    it(`${cli}: valid JSON with an object hooks registering exactly the R5 events`, () => {
      assert.ok(isObj(hooks), "hooks is an object");
      assert.equal(Object.keys(hooks).sort().join(" "), sortedEvents(cli));
    });
    it(`${cli}: one capture handler per event and nothing else`, () => {
      const all = handlers(cfg);
      assert.equal(all.length, cliEvents(cli).length);
      assert.deepEqual(
        all.filter((x) => !isCapture(x.h)),
        [],
      );
    });
    it(`${cli}: carries no MEMPALACE setting (R3)`, () => {
      assert.doesNotMatch(fs.readFileSync(frag(cli), "utf8"), /MEMPALACE/);
    });
    it(`${cli}: the substituted fragment is the direct node form with the coupled arguments`, () => {
      const r = runOptin("fragment", [cli, REPO], { env: s.env });
      assert.equal(r.status, 0, r.stderr);
      assert.doesNotMatch(r.stdout, /(CLAUDE|GEMINI|COPILOT)_PROJECT_DIR/);
      const out = JSON.parse(r.stdout) as Json;
      const coupled = path.join(s.tmp, `coupled-${cli}.json`);
      materialize(`${cli}-coupled.json`, coupled, s.home);
      for (const ev of cliEvents(cli)) {
        const [got] = captureCmds(out, ev);
        const [old] = captureCmds(readJson(coupled), ev);
        const want = (old ?? "").replace(/^bash "?[^ "]*\/hooks\/usage-capture\.sh"? /, "");
        assert.ok(want !== "" && want !== old, `${cli} ${ev}: the coupled arguments were found`);
        assert.equal(got, expectedCmd(cli, ev, CAPTURE_ABS));
        assert.equal(got, `node "${CAPTURE_ABS}" ${want}`);
        assert.ok(want.startsWith(cliTag(cli)));
      }
      s.cleanup();
    });
  }
  it("gemini-coupled.json keeps the legacy unquoted command (the migration input)", () => {
    const s = scratch();
    const coupled = path.join(s.tmp, "gemini-coupled.json");
    materialize("gemini-coupled.json", coupled, s.home);
    assert.deepEqual(captureCmds(readJson(coupled), "AfterModel"), [
      legacyCmd("gemini", "AfterModel", CAPTURE_SH_ABS),
    ]);
    s.cleanup();
  });
});

describe("G2 session recording owns no capture (R2)", () => {
  for (const cli of OPTIN_CLIS) {
    it(`${cli}: the transcript manifest names neither usage-capture.sh nor usage-capture.ts`, () => {
      const text = fs.readFileSync(
        path.join(REPO, "hooks", `${cli}-transcript-hooks.json`),
        "utf8",
      );
      assert.doesNotMatch(text, /usage-capture\.(sh|ts)/);
    });
    it(`${cli}: the declared session-recording step owns only its own prompts, before usage-capture`, () => {
      const d = declOf(cli);
      const rec = d.facts.get("prompts.session-recording");
      const uc = d.facts.get("prompts.usage-capture");
      const [recNo, ucNo] = [stepNo(d, "session-recording"), stepNo(d, "usage-capture")];
      assert.ok(rec && uc && recNo > 0 && ucNo > 0, "the declaration is not vacuous");
      assert.equal(rec, "transcripts,transcripts-confirm");
      assert.ok(!rec.includes("usage"));
      assert.equal(uc, "usage-capture,usage-capture-keep");
      assert.ok(recNo < ucNo, `session recording (${recNo}) before usage capture (${ucNo})`);
    });
  }
});

describe("G30 declared prompts and options (R1, R4, R10, R15)", () => {
  for (const cli of OPTIN_CLIS) {
    it(`${cli}: enable options no,yes; keep options keep,remove; headers name usage; hooks.src`, () => {
      const d = declOf(cli);
      const f = (k: string): string => d.facts.get(k) ?? "";
      assert.ok(
        stepNo(d, "usage-capture") > stepNo(d, "session-recording") &&
          stepNo(d, "session-recording") > 0,
      );
      assert.equal(f("prompt.usage-capture.options"), "no,yes");
      assert.equal(f("prompt.usage-capture-keep.options"), "keep,remove");
      assert.match(f("prompt.usage-capture.header"), /usage/i);
      assert.match(f("prompt.usage-capture-keep.header"), /usage/i);
      assert.equal(f("hooks.src"), `<REPO>/hooks/${cli}-transcript-hooks.json`);
    });
  }
  it("gemini: the mcp step (with the settings-write sub-step) precedes usage-capture", () => {
    const d = declOf("gemini");
    const subs = (d.facts.get("substeps.mcp") ?? "").split(",");
    assert.ok(stepNo(d, "mcp") > 0 && stepNo(d, "usage-capture") > 0, "both steps are declared");
    assert.ok(subs.includes("gemini-settings-write"), `sub-steps: ${subs.join(",")}`);
    assert.ok(stepNo(d, "mcp") < stepNo(d, "usage-capture"));
  });
});

describe("G31 antigravity and behaviour file guard", () => {
  it("every hooks/antigravity-* file references no usage-capture fragments", () => {
    const files = fs
      .readdirSync(path.join(REPO, "hooks"))
      .filter((f) => f.startsWith("antigravity-"));
    assert.ok(files.length > 0, "the glob is not empty");
    for (const f of files) {
      const text = fs.readFileSync(path.join(REPO, "hooks", f), "utf8");
      assert.doesNotMatch(text, /usage-capture-hooks\.json|merge_session_recording_hooks/, f);
    }
  });
  it("setup-retarget-behaviour-a.test.ts keeps its four usage-capture tests", () => {
    const text = fs.readFileSync(
      path.join(REPO, "scripts", "tests", "setup-retarget-behaviour-a.test.ts"),
      "utf8",
    );
    const blocks = [...text.matchAll(/describe\("usage-capture:/g)].length;
    const from = text.indexOf("usage-capture: enabled with MemPalace absent");
    const loop = /for \(const cli of \[([^\]]*)\] as const\)/.exec(text.slice(from))?.[1] ?? "";
    const perCli = loop.split(",").filter((x) => x.trim() !== "").length;
    assert.equal(blocks, 2);
    assert.equal(
      1 + perCli,
      4,
      "1 failure-does-not-abort test + one MemPalace-absent test per CLI",
    );
  });
});

describe("G32 the independent oracle agrees with the recognition corpus", () => {
  it("every corpus row: isCapture equals the row's capture flag (non-vacuous)", () => {
    const rows = readJson(CORPUS);
    assert.ok(Array.isArray(rows) && rows.length > 0, "the corpus has rows");
    for (const row of rows) {
      assert.ok(isObj(row) && typeof row["command"] === "string");
      const got = isCapture({ type: "command", command: row["command"] });
      assert.equal(got, row["capture"], `${row["command"]} (${String(row["note"])})`);
    }
  });
  it("the fixture directory is not empty", () => {
    assert.ok(fs.readdirSync(FIX_DIR).filter((f) => f.endsWith(".json")).length >= 11);
  });
});

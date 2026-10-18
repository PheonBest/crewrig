// usage-capture-optin-remove.test.ts — `remove` and look-alike safety (spec 0263, row J1b; port of
// sections 3 (g), (h) and (p) of test-setup-usage-capture-optin.sh: groups G13, G14, G22). Calls
// scripts/usage-capture-optin.ts through runOptin; the oracle is optin-oracle.ts.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  addCmds,
  CAPTURE_ABS,
  FIX_DIR,
  initCfg,
  materialize,
  REPO,
  runOptin,
  scratch,
} from "./lib/optin-fixtures.ts";
import { addRaw, assertCaptureOnceAt, detect } from "./lib/optin-merge-remove.ts";
import {
  backups,
  canonical,
  cliEvents,
  cliTag,
  expectedCmd,
  isObj,
  jsonEq,
  noncaptureView,
  OPTIN_CLIS,
  readJson,
  stripCaptureNoPrune,
  totalCapture,
  type Json,
} from "./lib/optin-oracle.ts";

const write = (file: string, doc: Json): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
};
const hooksOf = (file: string): { [k: string]: Json } => {
  const cfg = readJson(file);
  const h = isObj(cfg) ? cfg["hooks"] : undefined;
  return isObj(h) ? h : {};
};

describe("G13 remove on a coupled install leaves session recording and the guard (R9, R12)", () => {
  for (const cli of OPTIN_CLIS) {
    it(`${cli}: rc 0 with a backup, no capture left, state absent, the rest untouched`, (t) => {
      const s = scratch();
      t.after(s.cleanup);
      const cfg = path.join(s.tmp, cli, "config.json");
      materialize(`${cli}-coupled.json`, cfg, s.home);
      const expect = path.join(s.tmp, `${cli}-expect.json`);
      write(expect, stripCaptureNoPrune(readJson(cfg)));
      const r = runOptin("remove", [cli, cfg], { env: s.env });
      assert.equal(r.status, 0, r.stderr);
      assert.ok(backups(cfg).length > 0, "remove backs the file up first");
      assert.equal(totalCapture(readJson(cfg)), 0);
      assert.equal(detect(s.env, cli, cfg).state, "absent");
      assert.ok(
        jsonEq(cfg, expect),
        "transcript and guard entries equal the fixture minus capture",
      );
    });
    it(`${cli}: remove on an absent file writes nothing (R9)`, (t) => {
      const s = scratch();
      t.after(s.cleanup);
      const absent = path.join(s.tmp, `${cli}-absent`, "config.json");
      const r = runOptin("remove", [cli, absent], { env: s.env });
      assert.equal(r.status, 0, r.stderr);
      assert.equal(fs.existsSync(absent), false);
      assert.equal(fs.existsSync(path.dirname(absent)) ? backups(absent).length : 0, 0);
    });
  }
});

describe("G14 remove keeps the operator handler and prunes emptied containers only (R7, R12)", () => {
  const fixtures = [
    "claude-operator",
    "gemini-operator",
    "gemini-capture-only",
    "copilot-operator",
  ];
  const result = new Map<string, string>();
  for (const fixture of fixtures) {
    it(`${fixture}: apply remove leaves what capture-never-enabled holds`, (t) => {
      const s = scratch();
      t.after(s.cleanup);
      const cli = fixture.split("-")[0] ?? "";
      const cfg = path.join(s.tmp, fixture, "config.json");
      materialize(`${fixture}.json`, cfg, s.home);
      const r = runOptin("apply", [cli, cfg, REPO, "installed", "remove"], { env: s.env });
      assert.equal(r.status, 0, r.stderr);
      result.set(fixture, fs.readFileSync(cfg, "utf8"));
      assert.equal(
        canonical(JSON.parse(result.get(fixture) ?? "null") as Json),
        canonical(readJson(path.join(FIX_DIR, `${fixture}-stripped.json`))),
      );
    });
  }
  const parsed = (f: string): Json => JSON.parse(result.get(f) ?? "null") as Json;
  it("claude: Stop carries the operator command alone and SessionEnd is gone (scenario 9)", () => {
    const cfg = parsed("claude-operator");
    const hooks = isObj(cfg) && isObj(cfg["hooks"]) ? cfg["hooks"] : {};
    assert.equal(
      canonical(hooks["Stop"]),
      '[{"hooks":[{"command":"/opt/operator/bin/notify-done.sh","type":"command"}],"matcher":""}]',
    );
    assert.equal("SessionEnd" in hooks, false);
  });
  it("gemini: a capture-only settings.json loses its hooks key", () => {
    const cfg = parsed("gemini-capture-only");
    assert.ok(isObj(cfg) && !("hooks" in cfg));
  });
  it("copilot: the manifest keeps its hooks object and version 1", () => {
    const cfg = parsed("copilot-operator");
    assert.ok(isObj(cfg) && isObj(cfg["hooks"]) && cfg["version"] === 1);
  });
});

const posixOnly = process.platform === "win32" ? "POSIX-only: a file named with `&&`" : false;

describe("G22 look-alike commands are never capture and never touched (S2, N1)", () => {
  for (const cli of OPTIN_CLIS) {
    const prep = (s: ReturnType<typeof scratch>): { base: string; foreign: string } => {
      const foreign = path.join(s.tmp, "operator-tools", "hooks", "usage-capture.sh");
      fs.mkdirSync(path.dirname(foreign), { recursive: true });
      fs.writeFileSync(foreign, "#!/bin/bash\nexit 0\n");
      const doc = initCfg(cli);
      const tag = cliTag(cli);
      for (const ev of cliEvents(cli)) {
        addRaw(
          doc,
          cli,
          ev,
          `bash "${foreign}" --weekly-report`,
          `bash "${foreign}" ${tag} ${ev} --extra`,
          `bash "${foreign}" nightly`,
          `bash "${foreign}" other-cli ${ev}`,
          `echo hi; bash "${CAPTURE_ABS}" ${tag} ${ev}`,
          `bash "/opt/x/hooks/my-usage-capture.sh" ${tag} ${ev}`,
        );
      }
      const first = cliEvents(cli)[0] ?? "";
      const prompt = { type: "prompt", command: expectedCmd(cli, first, CAPTURE_ABS) };
      const hooks = (doc as { hooks: { [k: string]: Json[] } }).hooks;
      const list = hooks[first] ?? [];
      const head = list[0];
      if (cli === "copilot") list.push(prompt);
      else if (isObj(head) && Array.isArray(head["hooks"])) head["hooks"].push(prompt);
      const base = path.join(s.tmp, `${cli}-foreign.json`);
      write(base, doc);
      return { base, foreign };
    };
    it(`${cli}: look-alikes are not capture: state absent, empty footprint, no path`, (t) => {
      const s = scratch();
      t.after(s.cleanup);
      const d = detect(s.env, cli, prep(s).base);
      assert.deepEqual(d, { state: "absent", footprint: 0, paths: "" });
    });
    it(`${cli}: remove deletes crewrig's capture and leaves every look-alike`, (t) => {
      const s = scratch();
      t.after(s.cleanup);
      const { base } = prep(s);
      const cfg = path.join(s.tmp, "remove", "config.json");
      const doc = readJson(base);
      addCmds(doc, cli, CAPTURE_ABS);
      write(cfg, doc);
      const r = runOptin("remove", [cli, cfg], { env: s.env });
      assert.equal(r.status, 0, r.stderr);
      assert.ok(jsonEq(cfg, base), canonical(hooksOf(cfg)));
    });
    it(`${cli}: keep beside crewrig's capture is a byte-identical no-op with no backup`, (t) => {
      const s = scratch();
      t.after(s.cleanup);
      const { base } = prep(s);
      const cfg = path.join(s.tmp, "noop", "config.json");
      const doc = readJson(base);
      addCmds(doc, cli, CAPTURE_ABS);
      write(cfg, doc);
      const orig = fs.readFileSync(cfg);
      const r = runOptin("keep", [cli, cfg, REPO], { env: s.env });
      assert.equal(r.status, 0, r.stderr);
      assert.ok(fs.readFileSync(cfg).equals(orig));
      assert.equal(backups(cfg).length, 0);
    });
    it(`${cli}: keep over look-alikes only adds crewrig's capture and leaves the rest`, (t) => {
      const s = scratch();
      t.after(s.cleanup);
      const { base } = prep(s);
      const cfg = path.join(s.tmp, "add", "config.json");
      fs.mkdirSync(path.dirname(cfg), { recursive: true });
      fs.copyFileSync(base, cfg);
      const r = runOptin("keep", [cli, cfg, REPO], { env: s.env });
      assert.equal(r.status, 0, r.stderr);
      assert.notEqual(noncaptureView(readJson(base)), "");
      assert.equal(noncaptureView(readJson(cfg)), noncaptureView(readJson(base)));
      assertCaptureOnceAt(readJson(cfg), cli, CAPTURE_ABS);
    });
  }

  const n1 = (s: ReturnType<typeof scratch>): { label: string; cmd: string; skip?: string }[] => {
    const pre = path.join(s.tmp, "n1", "prep");
    const cap = path.join(s.tmp, "n1", "tools", "hooks", "usage-capture.sh");
    fs.mkdirSync(path.dirname(cap), { recursive: true });
    fs.writeFileSync(cap, "#!/bin/bash\nexit 0\n");
    const rows = [
      { label: "and", cmd: `bash /opt/prep.sh && ${CAPTURE_ABS} gemini-cli AfterModel` },
      { label: "semi", cmd: `bash /opt/notify.sh; bash ${CAPTURE_ABS} gemini-cli AfterModel` },
      { label: "toolarg", cmd: "bash /x/tool /a b/hooks/usage-capture.sh gemini-cli AfterModel" },
      { label: "and-existing", cmd: `bash ${pre} && ${cap} gemini-cli AfterModel` },
    ];
    // The existing-file row: a real file named `<pre> && <cap>`, so only the path class can reject.
    const odd = `${pre} && ${cap}`;
    if (!posixOnly) {
      fs.mkdirSync(path.dirname(odd), { recursive: true });
      fs.writeFileSync(odd, "#!/bin/bash\nexit 0\n");
    }
    return rows.map((r) =>
      r.label === "and-existing" && posixOnly ? { ...r, skip: posixOnly } : r,
    );
  };
  for (const label of ["and", "semi", "toolarg", "and-existing"]) {
    it(`gemini N1 '${label}': not capture; remove and keep leave it byte-unchanged`, (t) => {
      const s = scratch();
      t.after(s.cleanup);
      const row = n1(s).find((r) => r.label === label);
      if (row === undefined) throw new Error(`no row ${label}`);
      if (row.skip) return t.skip(row.skip);
      const base = path.join(s.tmp, `n1-${label}.json`);
      const doc = initCfg("gemini");
      addRaw(doc, "gemini", "AfterModel", "echo operator", row.cmd);
      write(base, doc);
      const d = detect(s.env, "gemini", base);
      assert.deepEqual(d, { state: "absent", footprint: 0, paths: "" });
      assert.equal(totalCapture(readJson(base)), 0);
      const rm = path.join(s.tmp, "rm", "config.json");
      fs.mkdirSync(path.dirname(rm), { recursive: true });
      fs.copyFileSync(base, rm);
      assert.equal(runOptin("remove", ["gemini", rm], { env: s.env }).status, 0);
      assert.ok(jsonEq(rm, base));
      const keep = path.join(s.tmp, "keep", "config.json");
      fs.mkdirSync(path.dirname(keep), { recursive: true });
      fs.copyFileSync(base, keep);
      const k = runOptin("keep", ["gemini", keep, REPO], { env: s.env });
      assert.equal(k.status, 0, k.stderr);
      assert.doesNotMatch(k.stdout + k.stderr, /re-pointed/);
      assert.equal(noncaptureView(readJson(keep)), noncaptureView(readJson(base)));
      const after = hooksOf(keep)["AfterModel"];
      const cmds = JSON.stringify(after);
      assert.ok(cmds.includes(JSON.stringify(row.cmd).slice(1, -1)), "operator command unchanged");
      assertCaptureOnceAt(readJson(keep), "gemini", CAPTURE_ABS);
    });
  }
});

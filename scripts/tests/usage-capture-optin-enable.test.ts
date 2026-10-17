// usage-capture-optin-enable.test.ts — enable, disclosure, decline answers, operator entries, the
// enable/remove round trip and the footprint/reinject contract of the usage-capture opt-in (spec
// 0263, row J1b; port of sections 3 (a), (a'), (b), (c), (i), (j) of
// test-setup-usage-capture-optin.sh: groups G3, G4, G5, G6, G15, G16). The replacement calls the
// TypeScript entry scripts/usage-capture-optin.ts. The oracle is optin-oracle.ts.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { assertOnceAt } from "./lib/optin-enable.ts";
import {
  CAPTURE_ABS,
  CAPTURE_SH_ABS,
  FIX_DIR,
  materialize,
  REPO,
  runOptin,
  scratch,
} from "./lib/optin-fixtures.ts";
import {
  backups,
  canonical,
  cliEvents,
  fileMode,
  handlers,
  homeConfig,
  isCapture,
  jsonEq,
  noncaptureView,
  OPTIN_CLIS,
  readJson,
  totalCapture,
  type Json,
} from "./lib/optin-oracle.ts";

const both = (r: { stdout: string; stderr: string }): string => r.stdout + r.stderr;

describe("G3 enable on an absent file (R2, R3, R5, R9)", () => {
  for (const cli of OPTIN_CLIS) {
    it(`${cli}: creates the file with only the capture handlers, 0600, no backup`, (t) => {
      if (process.platform === "win32") t.skip("POSIX file modes");
      const s = scratch();
      const cfg = homeConfig(cli, s.home);
      const r = runOptin("enable", [cli, cfg, REPO], { env: s.env });
      assert.equal(r.status, 0, both(r));
      assert.ok(fs.existsSync(cfg), "the file was created");
      assertOnceAt(cfg, cli, CAPTURE_ABS);
      const doc = readJson(cfg);
      assert.deepEqual(
        handlers(doc).filter((x) => !isCapture(x.h)),
        [],
      );
      assert.ok(!("env" in (doc as object)), "no env key");
      assert.doesNotMatch(fs.readFileSync(cfg, "utf8"), /MEMPALACE/);
      assert.deepEqual(backups(cfg), []);
      assert.equal(fileMode(cfg), 0o600);
      // G30 leg: no usage-capture.sh is deployed under the CLI homes
      const stray = fs
        .readdirSync(s.home, { recursive: true, encoding: "utf8" })
        .filter((f) => path.basename(f) === "usage-capture.sh");
      assert.deepEqual(stray, []);
      s.cleanup();
    });
  }
});

describe("G4 disclosure before writing (R6)", () => {
  for (const cli of OPTIN_CLIS) {
    it(`${cli}: names the events, the path, the file, no prompt text, no MemPalace; writes nothing`, () => {
      const s = scratch();
      const cfg = path.join(s.tmp, "disclose", cli, "config.json");
      const r = runOptin("disclose", [cli, cfg, REPO], { env: s.env });
      const out = both(r);
      for (const needle of [...cliEvents(cli), CAPTURE_ABS, cfg])
        assert.ok(out.includes(needle), `disclosure names ${needle}`);
      assert.match(out, /no prompt or response text/i);
      assert.match(out, /MemPalace is not required/i);
      assert.ok(!fs.existsSync(cfg), "the config was not created");
      s.cleanup();
    });
  }
});

describe("G5 enable over operator entries (R7, R9)", () => {
  for (const cli of OPTIN_CLIS) {
    it(`${cli}: every operator handler and non-hook key is preserved, backup taken`, () => {
      const s = scratch();
      const cfg = path.join(s.tmp, "b", cli, "config.json");
      materialize(`${cli}-operator.json`, cfg, s.home);
      const before = noncaptureView(readJson(cfg));
      assert.notEqual(before, "", "the before-view is not empty");
      const r = runOptin("enable", [cli, cfg, REPO], { env: s.env });
      assert.equal(r.status, 0, both(r));
      assert.equal(noncaptureView(readJson(cfg)), before);
      assertOnceAt(cfg, cli, CAPTURE_ABS);
      assert.ok(backups(cfg).length > 0, "the existing file was backed up");
      s.cleanup();
    });
  }
});

describe("G6 an empty or 'no' answer on state absent writes nothing (R4)", () => {
  for (const cli of OPTIN_CLIS) {
    for (const answer of ["", "no"]) {
      const label = answer === "" ? "empty" : answer;
      it(`${cli}: answer '${label}' on an absent file creates nothing and says how to enable later`, () => {
        const s = scratch();
        const cfg = path.join(s.tmp, "c", `${cli}-absent-${label}`, "config.json");
        const r = runOptin("apply", [cli, cfg, REPO, "absent", answer], { env: s.env });
        assert.equal(r.status, 0, both(r));
        assert.ok(!fs.existsSync(path.dirname(cfg)), "nothing was created");
        assert.ok(both(r).includes("not enabled"));
        assert.ok(both(r).includes(`setup-${cli}-interactive.sh`));
        s.cleanup();
      });
      it(`${cli}: answer '${label}' on an existing file modifies nothing and backs up nothing`, () => {
        const s = scratch();
        const cfg = path.join(s.tmp, "c", `${cli}-existing-${label}`, "config.json");
        materialize(`${cli}-operator-stripped.json`, cfg, s.home);
        const orig = fs.readFileSync(cfg);
        runOptin("apply", [cli, cfg, REPO, "absent", answer], { env: s.env });
        assert.ok(orig.equals(fs.readFileSync(cfg)), "byte-identical");
        assert.deepEqual(backups(cfg), []);
        s.cleanup();
      });
    }
  }
});

describe("G15 enable then remove returns the original (R12)", () => {
  const fixtures = [
    "claude-nohooks",
    "claude-operator-stripped",
    "gemini-operator-stripped",
    "gemini-capture-only-stripped",
    "copilot-operator-stripped",
  ];
  for (const fixture of fixtures) {
    it(`${fixture}: enable+remove is canonical-JSON-equal to the original`, () => {
      const cli = fixture.split("-")[0] ?? "";
      const s = scratch();
      const cfg = path.join(s.tmp, "i", fixture, "config.json");
      materialize(`${fixture}.json`, cfg, s.home);
      const r1 = runOptin("enable", [cli, cfg, REPO], { env: s.env });
      assert.equal(r1.status, 0, both(r1));
      assert.ok(totalCapture(readJson(cfg)) > 0, "capture was enabled");
      const r2 = runOptin("remove", [cli, cfg], { env: s.env });
      assert.equal(r2.status, 0, both(r2));
      assert.ok(jsonEq(cfg, path.join(FIX_DIR, `${fixture}.json`)));
      s.cleanup();
    });
  }
});

describe("G16 footprint / reinject library contract", () => {
  const template = path.join(REPO, "config", "gemini", "settings.json");
  const state = (s: { env: NodeJS.ProcessEnv }, cfg: string): string =>
    runOptin("state", ["gemini", cfg], { env: s.env }).stdout.trim();
  it("a footprint reinjected into the Gemini template is 'installed', legacy form verbatim", () => {
    const s = scratch();
    const cfg = path.join(s.tmp, "j", "settings.json");
    materialize("gemini-coupled.json", cfg, s.home);
    const fp = runOptin("footprint", ["gemini", cfg], { env: s.env });
    assert.equal(fp.status, 0, both(fp));
    assert.equal((JSON.parse(fp.stdout) as Json[]).length, 1);
    fs.copyFileSync(template, cfg);
    const r = runOptin("reinject", ["gemini", cfg, fp.stdout.trim()], { env: s.env });
    assert.equal(r.status, 0, both(r));
    assert.equal(state(s, cfg), "installed");
    assertOnceAt(cfg, "gemini", CAPTURE_SH_ABS, "legacy");
    const strip = (f: string): string => {
      const d = readJson(f);
      if (typeof d === "object" && d !== null && !Array.isArray(d)) delete d["hooks"];
      return canonical(d);
    };
    assert.equal(strip(cfg), strip(template), "only the capture entry changed");
    s.cleanup();
  });
  it("the footprint of an absent file is []", () => {
    const s = scratch();
    const r = runOptin("footprint", ["gemini", path.join(s.tmp, "absent.json")], { env: s.env });
    assert.equal(r.status, 0, both(r));
    assert.deepEqual(JSON.parse(r.stdout), []);
    s.cleanup();
  });
  it("the footprint of an unparsable file returns 2 and leaves it untouched", () => {
    const s = scratch();
    const broken = path.join(s.tmp, "broken.json");
    fs.writeFileSync(broken, '{"hooks": ');
    const r = runOptin("footprint", ["gemini", broken], { env: s.env });
    assert.equal(r.status, 2);
    assert.equal(fs.readFileSync(broken, "utf8"), '{"hooks": ');
    s.cleanup();
  });
});

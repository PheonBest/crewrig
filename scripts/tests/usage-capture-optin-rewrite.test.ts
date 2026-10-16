// usage-capture-optin-rewrite.test.ts — `rewrite` and the assignment-prefixed legacy commands of the
// usage-capture opt-in (spec 0263, row J1b; port of §6 (b), (c), (c2), (c3) of
// test-setup-usage-capture-optin.sh: groups G33, G34, G35, G36). The Windows target of G36 is the
// entry's `--platform win32` flag; the shim's `uname` leg is covered by setup-lib-shim-usage.test.ts.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  addCmds,
  CAPTURE_ABS,
  CAPTURE_SH_ABS,
  materialize,
  REPO,
  scratch,
} from "./lib/optin-fixtures.ts";
import {
  both,
  firstEvent,
  prefixCapture,
  run,
  same,
  usageCaptureStub,
} from "./lib/optin-keepkit.ts";
import {
  backups,
  captureCmds,
  captureCount,
  expectedCmd,
  fileMode,
  noncaptureView,
  OPTIN_CLIS,
  readJson,
} from "./lib/optin-oracle.ts";

const PREFIX = "CREWRIG_USAGE_ROOT=/Volumes/enc/usage ";
const modeOk = (f: string): boolean => process.platform === "win32" || fileMode(f) === 0o600;

describe("G33 rewrite: a legacy command becomes direct exactly once (R19, R22)", () => {
  for (const cli of OPTIN_CLIS) {
    it(`${cli}: direct form, other entries preserved, one backup, 0600, second run a no-op`, () => {
      const s = scratch();
      try {
        const cfg = path.join(s.tmp, "v", cli, "config.json");
        materialize(`${cli}-operator.json`, cfg, s.home);
        const orig = `${cfg}.orig`;
        fs.copyFileSync(cfg, orig);
        const r = run(s, "rewrite", cli, cfg, REPO);
        const ev = firstEvent(cli);
        assert.equal(r.status, 0, both(r));
        assert.deepEqual(captureCmds(readJson(cfg), ev), [expectedCmd(cli, ev, CAPTURE_ABS)]);
        assert.equal(noncaptureView(readJson(cfg)), noncaptureView(readJson(orig)));
        assert.equal(backups(cfg).length, 1);
        assert.ok(modeOk(cfg), "mode 0600");
        const first = `${cfg}.first`;
        fs.copyFileSync(cfg, first);
        assert.equal(run(s, "rewrite", cli, cfg, REPO).status, 0);
        assert.ok(same(cfg, first), "a second rewrite writes nothing");
        assert.equal(backups(cfg).length, 1);
      } finally {
        s.cleanup();
      }
    });
    it(`${cli}: a legacy and a direct command on one event end as one direct command`, () => {
      const s = scratch();
      try {
        const twin = path.join(s.tmp, "v", `${cli}-twin`, "config.json");
        materialize(`${cli}-coupled.json`, twin, s.home);
        const doc = readJson(twin);
        addCmds(doc, cli, CAPTURE_ABS);
        fs.writeFileSync(twin, JSON.stringify(doc));
        const ev = firstEvent(cli);
        assert.equal(captureCount(readJson(twin), ev), 2, "the twin is really there");
        run(s, "rewrite", cli, twin, REPO);
        assert.deepEqual(captureCmds(readJson(twin), ev), [expectedCmd(cli, ev, CAPTURE_ABS)]);
      } finally {
        s.cleanup();
      }
    });
  }
});

describe("G34 a legacy command whose checkout has no .ts is left, with the reason (R21)", () => {
  for (const cli of OPTIN_CLIS)
    it(`${cli}: byte-identical, no backup, the report says why`, () => {
      const s = scratch();
      try {
        const old = usageCaptureStub(path.join(s.tmp, "v", "old-checkout"));
        const cfg = path.join(s.tmp, "v", `${cli}-old`, "config.json");
        materialize(`${cli}-coupled.json`, cfg, s.home, old);
        const orig = `${cfg}.orig`;
        fs.copyFileSync(cfg, orig);
        const r = run(s, "rewrite", cli, cfg, REPO);
        assert.equal(r.status, 0, both(r));
        assert.ok(same(cfg, orig));
        assert.equal(backups(cfg).length, 0);
        assert.match(both(r), /no \.ts next to the registered \.sh/);
      } finally {
        s.cleanup();
      }
    });
});

describe("G35 an environment-prefixed legacy command is left and reported by name", () => {
  for (const cli of OPTIN_CLIS)
    it(`${cli}: byte-identical, names the variable and never its value`, () => {
      const s = scratch();
      try {
        const cfg = path.join(s.tmp, "v", `${cli}-envprefix`, "config.json");
        materialize(`${cli}-coupled.json`, cfg, s.home);
        prefixCapture(cfg, PREFIX);
        const orig = `${cfg}.orig`;
        fs.copyFileSync(cfg, orig);
        const r = run(s, "rewrite", cli, cfg, REPO);
        assert.equal(r.status, 0, both(r));
        assert.ok(same(cfg, orig));
        assert.equal(backups(cfg).length, 0);
        assert.ok(both(r).includes("environment prefix (CREWRIG_USAGE_ROOT=...)"), both(r));
        assert.ok(!both(r).includes("/Volumes/enc/usage"), "the value is not echoed");
      } finally {
        s.cleanup();
      }
    });
});

describe("G36 keep on an assignment-prefixed command with a vanished path (s4-F2)", () => {
  for (const cli of OPTIN_CLIS)
    for (const target of ["posix", "windows"] as const) {
      const leftOnWindows = target === "windows" && cli !== "claude";
      it(`${cli} on ${target}: ${leftOnWindows ? "left and reported by name" : "re-pointed keeping the prefix"}`, () => {
        const s = scratch();
        try {
          const gone = path.join(s.tmp, "v", "gone-checkout", "hooks", "usage-capture.sh");
          const cfg = path.join(s.tmp, "v", `${cli}-${target}-vanished`, "config.json");
          materialize(`${cli}-coupled.json`, cfg, s.home, gone);
          prefixCapture(cfg, PREFIX);
          const orig = `${cfg}.orig`;
          fs.copyFileSync(cfg, orig);
          const r = run(s, "keep", cli, cfg, REPO, target === "windows" ? "win32" : undefined);
          assert.equal(r.status, 0, both(r));
          if (leftOnWindows) {
            assert.ok(same(cfg, orig));
            assert.equal(backups(cfg).length, 0);
            assert.ok(
              both(r).includes(
                `left ${gone}: keeps an environment prefix (CREWRIG_USAGE_ROOT=...)`,
              ),
              both(r),
            );
            assert.doesNotMatch(both(r), /re-pointed/);
            assert.ok(!both(r).includes("/Volumes/enc/usage"), "the value is not echoed");
          } else {
            assert.match(both(r), /re-pointed/);
            assert.equal(backups(cfg).length, 1);
            assert.ok(modeOk(cfg), "mode 0600");
            const [got] = captureCmds(readJson(cfg), firstEvent(cli));
            assert.ok(got?.startsWith(`${PREFIX}bash "${CAPTURE_SH_ABS}" `), got);
          }
        } finally {
          s.cleanup();
        }
      });
    }
});

// setup-lib-usage-entry.test.ts — scripts/usage-capture-optin.ts, the entry behind the usage-capture setup
// steps (spec 0256 requirement 33, plan v2 step B3b.4). Per subcommand, the entry runs in a throwaway HOME
// and must exit with a status, not crash. The shell oracle went with retired scripts/lib/usage-capture-optin.sh
// (spec 0266); the outcomes are asserted by setup-usage-capture.test.ts and its siblings.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import { same } from "./lib/usage-entry-rig.ts";
import { cap, CLIS, configOf, SKIP, type Cli } from "./lib/usage-capture-rig.ts";
import { makeTranscriptCheckout, MANIFEST, q } from "./lib/transcript-fixtures.ts";
import { cleanupAll, realTmp } from "./lib/worktree-fixtures.ts";

after(cleanupAll);

const legacy = (cli: Cli): string => cap("/gone/co", cli, "sh");
const BAD = "[1, 2]";

describe("readers", { skip: SKIP }, () => {
  for (const cli of CLIS) {
    for (const [label, initial] of [
      ["absent file", undefined],
      ["installed", configOf(cli, [cap("/tmp/x", cli)])],
      ["not an object", BAD],
    ] as const) {
      for (const sub of ["state", "paths", "footprint"] as const) {
        test(`${sub} ${cli}: ${label}`, () => {
          same(initial, (f) => [sub, cli, f.cfg]);
        });
      }
    }
  }
  test("an unknown CLI is refused with status 1 on every reader", () => {
    for (const sub of ["state", "paths", "footprint"]) {
      same(undefined, (f) => [sub, "bogus", f.cfg]);
    }
  });
  test("abs: the physical path, the sh form, a missing script", () => {
    same(undefined, (f) => ["abs", f.co]);
    same(undefined, (f) => ["abs", f.co, "sh"]);
    same(undefined, (f) => ["abs", `${f.co}/nope`]);
  });
  test("fragment prints the shell's line for each CLI", () => {
    for (const cli of CLIS) same(undefined, (f) => ["fragment", cli, f.co]);
  });
});

describe("writers", { skip: SKIP }, () => {
  for (const cli of CLIS) {
    const live = configOf(cli, [cap("/tmp/x", cli)]);
    const stale = configOf(cli, [legacy(cli)]);
    test(`enable ${cli}: absent file, existing file, not an object`, () => {
      for (const initial of [undefined, configOf(cli, []), live, BAD]) {
        same(initial, (f) => ["enable", cli, f.cfg, f.co]);
      }
    });
    test(`remove ${cli}: installed, absent, not an object`, () => {
      for (const initial of [live, undefined, BAD]) {
        same(initial, (f) => ["remove", cli, f.cfg]);
      }
    });
    test(`keep ${cli}: a vanished registered path, a no-op, no file`, () => {
      for (const initial of [stale, undefined, configOf(cli, [])]) {
        same(initial, (f) => ["keep", cli, f.cfg, f.co]);
      }
    });
    test(`disclose and rewrite ${cli}`, () => {
      same(stale, (f) => ["disclose", cli, f.cfg, f.co]);
      same(stale, (f) => ["rewrite", cli, f.cfg, f.co]);
    });
    test(`reinject ${cli}: a footprint, an invalid one, a missing file`, () => {
      const fp = '[{"event":"x","selector":null,"handler":{"type":"command","command":"echo hi"}}]';
      same(live, (f) => ["reinject", cli, f.cfg, fp]);
      same(live, (f) => ["reinject", cli, f.cfg, "{"]);
      same(undefined, (f) => ["reinject", cli, f.cfg, fp]);
    });
    test(`apply ${cli}: every state and answer`, () => {
      const cases: [unknown, string, string][] = [
        [undefined, "absent", "yes"],
        [undefined, "absent", "no"],
        [live, "installed", "remove"],
        [stale, "installed", "keep"],
        [stale, "installed", ""],
        [live, "weird", "yes"],
      ];
      for (const [initial, state, answer] of cases) {
        same(initial, (f) => ["apply", cli, f.cfg, f.co, state, answer]);
      }
    });
  }
});

describe("render and merge", { skip: SKIP }, () => {
  for (const cli of CLIS) {
    const co = makeTranscriptCheckout();
    const wanted = { WANT_RES: "SR_TRANSCRIPT_WIRED" };
    test(`render ${cli}: the manifest bytes and SR_TRANSCRIPT_WIRED`, () => {
      const leg = same(undefined, (f) => [
        "render-session-recording-manifest",
        "--result",
        f.res,
        cli,
        co.repo,
        MANIFEST(cli),
        f.out,
      ]);
      assert.match(leg.result ?? "", /^SR_TRANSCRIPT_WIRED=1\n/);
    });
    test(`render ${cli}: a checkout with no transcript script falls back, wired 0`, () => {
      const bare = makeTranscriptCheckout("bare", { entry: false });
      const leg = same(undefined, (f) => [
        "render-session-recording-manifest",
        "--result",
        f.res,
        cli,
        bare.repo,
        MANIFEST(cli),
        f.out,
      ]);
      assert.match(leg.result ?? "", /^SR_TRANSCRIPT_WIRED=0\n/);
    });
    test(`merge ${cli}: onto absent, existing and capture-carrying files, with an env patch`, () => {
      const patch = cli === "claude" ? '{"MEMPALACE_TRANSCRIPT_ENABLED": "1"}' : "{}";
      for (const initial of [undefined, configOf(cli, [cap("/tmp/x", cli)]), BAD]) {
        same(initial, (f) => [
          "merge-session-recording-hooks",
          "--result",
          f.res,
          cli,
          f.cfg,
          MANIFEST(cli),
          patch,
        ]);
      }
    });
  }
  test("merge copilot keeps disableAllHooks: SR_ALL_HOOKS_DISABLED=1, the warning on standard error", () => {
    const leg = same({ version: 1, disableAllHooks: true, hooks: {} }, (f) => [
      "merge-session-recording-hooks",
      "--result",
      f.res,
      "copilot",
      f.cfg,
      MANIFEST("copilot"),
    ]);
    assert.match(leg.result ?? "", /SR_ALL_HOOKS_DISABLED=1\n$/);
    assert.match(leg.err, /disableAllHooks/);
  });
  test("merge refuses an invalid environment patch and a patched manifest that is no object", () => {
    const bad = path.join(realTmp("uc-bad-"), "m.json");
    fs.writeFileSync(bad, "[]");
    same(configOf("claude", []), (f) => [
      "merge-session-recording-hooks",
      "claude",
      f.cfg,
      MANIFEST("claude"),
      "{",
    ]);
    same(configOf("claude", []), (f) => ["merge-session-recording-hooks", "claude", f.cfg, bad]);
  });
});

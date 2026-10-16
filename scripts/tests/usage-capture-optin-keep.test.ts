// usage-capture-optin-keep.test.ts — `keep` of the usage-capture opt-in (spec 0263, row J1b; port of
// §3 (e), (f), (f') of test-setup-usage-capture-optin.sh: groups G10, G11, G12). G23, G24, G27 are in
// usage-capture-optin-keep-paths.test.ts, G33-G36 in usage-capture-optin-rewrite.test.ts. The oracle
// is optin-oracle.ts.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import {
  CAPTURE_ABS,
  CAPTURE_SH_ABS,
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
  captureCmds,
  captureCount,
  cliEvents,
  expectedCmd,
  isObj,
  nonR5Event,
  noncaptureView,
  OPTIN_CLIS,
  readJson,
  type Json,
} from "./lib/optin-oracle.ts";

describe("G10 a coupled install is detected as installed and kept (R10, R11, R13)", () => {
  for (const cli of OPTIN_CLIS) {
    it(`${cli}: installed, empty answer rewrites once, then byte-identical`, () => {
      const s = scratch();
      try {
        const cfg = path.join(s.tmp, "e", cli, "config.json");
        materialize(`${cli}-coupled.json`, cfg, s.home);
        const orig = `${cfg}.orig`;
        fs.copyFileSync(cfg, orig);
        assert.equal(stateOf(s, cli, cfg), "installed");
        const apply = (answer: string) =>
          runOptin("apply", [cli, cfg, REPO, "installed", answer], { env: s.env });
        const r1 = apply("");
        assert.equal(r1.status, 0, both(r1));
        const after1 = `${cfg}.after1`;
        fs.copyFileSync(cfg, after1);
        assert.equal(backups(cfg).length, 1);
        assert.equal(apply("").status, 0);
        assert.ok(same(cfg, after1), "the second run is byte-identical");
        assert.equal(backups(cfg).length, 1);
        assert.equal(noncaptureView(readJson(cfg)), noncaptureView(readJson(orig)));
        for (const ev of cliEvents(cli))
          assert.deepEqual(captureCmds(readJson(cfg), ev), [expectedCmd(cli, ev, CAPTURE_ABS)]);
        assert.doesNotMatch(both(r1), /re-pointed/);
        assert.match(both(r1), /rewrote/);
        assert.equal(apply("keep").status, 0);
        assert.ok(same(cfg, after1), "an explicit keep is byte-identical");
        assert.equal(backups(cfg).length, 1);
      } finally {
        s.cleanup();
      }
    });
    it(`${cli}: keep collapses a duplicated capture handler on the first event only`, () => {
      const s = scratch();
      try {
        const orig = path.join(s.tmp, "e", cli, "orig.json");
        materialize(`${cli}-coupled.json`, orig, s.home);
        const doc = readJson(orig);
        const ev = firstEvent(cli);
        const hooks = isObj(doc) ? doc["hooks"] : undefined;
        const list = isObj(hooks) ? hooks[ev] : undefined;
        assert.ok(Array.isArray(list));
        const first = list[0];
        if (cli === "copilot") list.push(list[list.length - 1] ?? null);
        else if (isObj(first) && Array.isArray(first["hooks"]))
          first["hooks"].push(first["hooks"][first["hooks"].length - 1] ?? null);
        const dup = path.join(s.tmp, "e", `${cli}-dup`, "config.json");
        writeJson(dup, doc);
        assert.equal(captureCount(readJson(dup), ev), 2, "the fixture really holds a twin");
        assert.equal(
          runOptin("apply", [cli, dup, REPO, "installed", "keep"], { env: s.env }).status,
          0,
        );
        assert.equal(captureCount(readJson(dup), ev), 1);
        assert.equal(noncaptureView(readJson(dup)), noncaptureView(readJson(orig)));
      } finally {
        s.cleanup();
      }
    });
  }
});

const git = (cwd: string, args: string[]): boolean =>
  spawnSync(
    "git",
    [
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.invalid",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_DIR: undefined,
        GIT_WORK_TREE: undefined,
        GIT_INDEX_FILE: undefined,
        GIT_COMMON_DIR: undefined,
      },
    },
  ).status === 0;
const haveGit = spawnSync("git", ["--version"]).status === 0;

describe("G11 keep re-points a vanished path and only a vanished path (R6, R11)", () => {
  const s = scratch();
  const main = path.join(s.tmp, "wt", "main");
  const linked = path.join(s.tmp, "wt", "linked");
  const skip = !haveGit && !process.env["CI"] ? "git is not installed" : false;
  before(() => {
    if (!haveGit) {
      assert.ok(!process.env["CI"], "git is required on CI");
      return;
    }
    usageCaptureStub(main);
    fs.writeFileSync(path.join(main, "hooks", "usage-capture.ts"), "// stub\n");
    for (const f of fs.readdirSync(path.join(REPO, "hooks")))
      if (f.endsWith("-usage-capture-hooks.json"))
        fs.copyFileSync(path.join(REPO, "hooks", f), path.join(main, "hooks", f));
    assert.ok(git(main, ["init", "-q"]));
    assert.ok(git(main, ["add", "hooks"]));
    assert.ok(git(main, ["commit", "-q", "-m", "init"]));
    assert.ok(git(main, ["worktree", "add", "-q", "--detach", linked]), "linked worktree created");
  });
  after(() => {
    try {
      if (haveGit && fs.existsSync(linked)) git(main, ["worktree", "remove", "--force", linked]);
    } finally {
      s.cleanup();
    }
  });
  for (const cli of OPTIN_CLIS) {
    it(
      `${cli}: still-resolving path untouched, vanished path re-pointed, worktree warning`,
      { skip },
      () => {
        const other = path.join(s.tmp, "f", `${cli}-other-checkout`, "hooks", "usage-capture.sh");
        fs.mkdirSync(path.dirname(other), { recursive: true });
        fs.copyFileSync(path.join(REPO, "hooks", "usage-capture.sh"), other);
        const cfg = path.join(s.tmp, "f", cli, "config.json");
        materialize(`${cli}-coupled.json`, cfg, s.home, other);
        const orig = `${cfg}.orig`;
        fs.copyFileSync(cfg, orig);
        const r0 = run(s, "keep", cli, cfg, REPO);
        assert.ok(same(cfg, orig), "a resolving path is untouched");
        assert.doesNotMatch(both(r0), /re-pointed/);
        assert.equal(backups(cfg).length, 0);

        fs.rmSync(other);
        const r1 = run(s, "keep", cli, cfg, REPO);
        assert.equal(r1.status, 0, both(r1));
        assert.match(both(r1), /re-pointed/);
        assertOnceAt(cli, cfg, CAPTURE_SH_ABS); // form-preserving: the `.sh` goes to the current `.sh`
        assert.equal(noncaptureView(readJson(cfg)), noncaptureView(readJson(orig)));
        assert.ok(backups(cfg).length > 0, "the re-point took a backup");

        const wt = path.join(s.tmp, "f", `${cli}-wt`, "config.json");
        materialize(
          `${cli}-coupled.json`,
          wt,
          s.home,
          path.join(s.tmp, "f", "vanished", "hooks", "usage-capture.sh"),
        );
        const wtSh = path.join(fs.realpathSync(path.join(linked, "hooks")), "usage-capture.sh");
        const r2 = run(s, "keep", cli, wt, linked);
        const ev = firstEvent(cli);
        assert.match(both(r2), /linked git worktree/);
        assert.deepEqual(captureCmds(readJson(wt), ev), [expectedCmd(cli, ev, wtSh)]);
        assert.doesNotMatch(
          both(run(s, "keep", cli, wt, linked)),
          /linked git worktree/,
          "a no-op keep prints no warning",
        );
        assert.match(both(run(s, "disclose", cli, wt, linked)), /linked git worktree/);
      },
    );
  }
});

describe("G12 a capture handler on a non-R5 event survives keep (R11)", () => {
  for (const cli of OPTIN_CLIS) {
    it(`${cli}: the hand-placed handler is byte-identical`, () => {
      const s = scratch();
      try {
        const cfg = path.join(s.tmp, "fp", cli, "config.json");
        materialize(`${cli}-coupled.json`, cfg, s.home);
        const doc = readJson(cfg);
        const ev = nonR5Event(cli);
        const hooks = isObj(doc) ? doc["hooks"] : undefined;
        assert.ok(isObj(hooks));
        const handler: Json = { type: "command", command: expectedCmd(cli, ev, CAPTURE_ABS) };
        const cur = hooks[ev];
        const add: Json = cli === "copilot" ? handler : { matcher: "Hand", hooks: [handler] };
        hooks[ev] = Array.isArray(cur) ? [...cur, add] : [add];
        writeJson(cfg, doc);
        const before = JSON.stringify(hooks[ev] ?? null);
        assert.equal(run(s, "keep", cli, cfg, REPO).status, 0);
        const now = readJson(cfg);
        const nowHooks = isObj(now) ? now["hooks"] : undefined;
        assert.equal(JSON.stringify(isObj(nowHooks) ? nowHooks[ev] : null), before);
        assert.equal(captureCount(now, ev), 1);
      } finally {
        s.cleanup();
      }
    });
  }
});

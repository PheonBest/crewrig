// setup-usage-capture.test.ts — the fragment, disclosure, writers and apply of
// scripts/lib/setup/usage-capture.ts (spec 0256 requirement 30, plan v2 step B3a.2b). The shell-versus-twin
// differential legs went with scripts/lib/usage-capture-optin.sh (spec 0266); each case now runs the TypeScript
// leg and asserts its outcome.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import type { Spawner } from "../lib/setup/context.ts";
import {
  usageCaptureApply,
  usageCaptureDisclose,
  usageCaptureEnable,
  usageCaptureFragment,
  usageCaptureReinject,
  usageCaptureRemove,
  usageCaptureRewrite,
} from "../lib/setup/usage-capture.ts";
import { captureFootprint } from "../lib/setup/usage-capture-state.ts";
import {
  cap,
  CLIS,
  checkout,
  configOf,
  differential,
  EVENT,
  floorOk,
  handler,
  mode,
  OK,
  pretty,
  rig,
  runCtx,
  SKIP,
  type Cli,
  type Run,
} from "./lib/usage-capture-rig.ts";
import { cleanupAll } from "./lib/worktree-fixtures.ts";

after(cleanupAll);
const COUNT = { claude: 2, gemini: 1, copilot: 2 } as const;

const enableTs =
  (cli: Cli) =>
  (run: Run, cfg: string, repo: string): number =>
    usageCaptureEnable({
      ctx: run.ctx,
      cli,
      settingsPath: cfg,
      repoDir: repo,
      deps: { spawn: floorOk },
    });

describe("usageCaptureFragment", { skip: SKIP }, () => {
  for (const cli of CLIS) {
    test(`${cli}: the rendered fragment holds one direct command per event`, () => {
      const co = checkout();
      const run = runCtx(co);
      const frag = usageCaptureFragment(run.ctx, cli, co, { spawn: floorOk });
      assert.equal(captureFootprint(cli, frag).length, COUNT[cli]);
    });
  }

  test("a missing fragment, an unknown CLI and a below-floor Node.js are refused with their diagnostic lines", () => {
    const co = checkout();
    fs.rmSync(path.join(co, "hooks", "gemini-usage-capture-hooks.json"));
    const run = runCtx(co);
    assert.equal(usageCaptureFragment(run.ctx, "gemini", co, { spawn: floorOk }), null);
    assert.equal(usageCaptureFragment(run.ctx, "antigravity", co), null);
    const low: Spawner = () => ({
      status: 1,
      stdout: "",
      stderr: "crewrig: requires Node.js >= 24\n",
    });
    const deps = { spawn: low, floorGuard: import.meta.filename };
    assert.equal(usageCaptureFragment(run.ctx, "claude", co, deps), null);
    assert.deepEqual(run.err, [
      `  ERROR: capture fragment not found at ${co}/hooks/gemini-usage-capture-hooks.json.`,
      "  ERROR: unknown CLI 'antigravity' (expected claude, gemini or copilot).",
      "crewrig: requires Node.js >= 24",
    ]);
  });
});

describe("usageCaptureDisclose", { skip: SKIP }, () => {
  for (const cli of CLIS) {
    test(`${cli}: the disclosure is written`, () => {
      differential(rig(undefined), (run, cfg, repo) =>
        usageCaptureDisclose({
          ctx: run.ctx,
          cli,
          settingsPath: cfg,
          repoDir: repo,
          deps: { spawn: floorOk },
        }),
      );
    });
  }

  test("a linked worktree adds the four warning lines before the blank line", () => {
    const co = checkout();
    const run = runCtx(co);
    const linked: Spawner = (argv) => (argv[0] === "git" ? { ...OK, stdout: "/main/.git\n" } : OK);
    const o = { ctx: run.ctx, cli: "claude", settingsPath: "/s", deps: { spawn: linked } };
    assert.equal(usageCaptureDisclose(o), 0);
    assert.equal(run.out.at(-1), "");
    assert.match(run.out.at(-5) ?? "", /WARNING: this checkout is a linked git worktree/);
  });
});

describe("usageCaptureEnable", { skip: SKIP }, () => {
  for (const cli of CLIS) {
    test(`${cli}: an absent file is created at 0600 with the fragment`, () => {
      const r = rig(undefined);
      const got = differential(r, enableTs(cli));
      assert.equal(mode(r.cfgT), 0o600);
      assert.equal(
        captureFootprint(cli, JSON.parse(got.file ?? "{}") as Record<string, unknown>).length,
        COUNT[cli],
      );
    });

    test(`${cli}: strip-then-add leaves one footprint beside the operator's hooks; a second run is the same`, () => {
      const co = checkout();
      const r = rig(configOf(cli, [cap(co, cli, "sh"), cap("/old/co", cli)]), co);
      differential(r, enableTs(cli));
      const doc = JSON.parse(fs.readFileSync(r.cfgT, "utf8")) as Record<string, unknown>;
      assert.equal(captureFootprint(cli, doc).length, COUNT[cli]);
      assert.equal(mode(r.cfgT), 0o600);
      assert.ok(
        fs.readdirSync(path.dirname(r.cfgT)).some((n) => n.startsWith("settings.json.bak.")),
      );
      differential(r, enableTs(cli));
    });
  }

  test("a grouped selector joins the first group with the same selector, else opens a group", () => {
    const hooks = [
      { matcher: "x", hooks: [] },
      { matcher: "", hooks: [handler("claude", "echo")] },
    ];
    differential(rig({ hooks: { Stop: hooks } }), enableTs("claude"));
  });

  test("a file that is not an object, and hooks that are not an object, are refused untouched", () => {
    for (const initial of ["[1]\n", "not json", pretty({ hooks: "x" })]) {
      const got = differential(rig(initial), enableTs("claude"));
      assert.equal(got.rc, 1);
      assert.equal(got.file, initial);
    }
  });
});

describe("usageCaptureRemove", { skip: SKIP }, () => {
  const remove = (cli: Cli) => (run: Run, cfg: string) =>
    usageCaptureRemove({ ctx: run.ctx, cli, settingsPath: cfg });
  for (const cli of CLIS) {
    test(`${cli}: only the emptied containers are pruned (R12)`, () => {
      const co = checkout();
      const one = handler(cli, cap(co, cli));
      const entries = cli === "copilot" ? [one] : [{ matcher: "", hooks: [one] }];
      const only = { model: "m", hooks: { [EVENT[cli]]: entries } };
      const mixed = configOf(cli, [cap(co, cli), cap(co, cli, "sh")]);
      for (const initial of [only, mixed, { hooks: {} }, { a: 1 }]) {
        differential(rig(initial, co), remove(cli));
      }
    });
  }

  test("an absent file writes nothing, a non-object file is refused", () => {
    assert.equal(differential(rig(undefined), remove("gemini")).file, null);
    assert.equal(differential(rig("[]"), remove("gemini")).rc, 1);
  });
});

describe("usageCaptureReinject", { skip: SKIP }, () => {
  const reinject = (fp: string) => (run: Run, cfg: string) =>
    usageCaptureReinject({
      ctx: run.ctx,
      cli: "claude",
      settingsPath: cfg,
      footprint: JSON.parse(fp) as unknown,
    });
  test("strip then add each entry, one write, no backup; invalid input is refused", () => {
    const co = checkout();
    const entry = {
      event: "Stop",
      selector: { matcher: "" },
      handler: handler("claude", cap(co, "claude")),
    };
    const fp = JSON.stringify([entry]);
    const r = rig(configOf("claude", [cap("/old", "claude")]), co);
    differential(r, reinject(fp));
    assert.equal(fs.readdirSync(path.dirname(r.cfgT)).length, 1);
    for (const bad of ["{}", '[{"event":3}]']) {
      const again = rig(configOf("claude", [cap(co, "claude")]), co);
      differential(again, reinject(bad));
    }
    differential(rig(undefined), reinject("[]"));
  });
});

describe("usageCaptureRewrite and usageCaptureApply", { skip: SKIP }, () => {
  test("rewrite brings a legacy command to the direct form", () => {
    const co = checkout();
    const r = rig(configOf("claude", [cap(co, "claude", "sh")]), co);
    differential(r, (run, cfg, repo) =>
      usageCaptureRewrite({
        ctx: run.ctx,
        cli: "claude",
        settingsPath: cfg,
        repoDir: repo,
        deps: { spawn: floorOk },
      }),
    );
    assert.match(
      fs.readFileSync(r.cfgT, "utf8"),
      /node \\"[^"]*usage-capture\.ts\\" claude-code Stop/,
    );
  });

  const apply =
    (cli: Cli, state: string, answer: string) => (run: Run, cfg: string, repo: string) =>
      usageCaptureApply({
        ctx: run.ctx,
        cli,
        settingsPath: cfg,
        repoDir: repo,
        state,
        answer,
        deps: { spawn: floorOk },
      });

  test("the (state, answer) mapping", () => {
    const co = checkout();
    const installed = configOf("gemini", [cap(co, "gemini")]);
    const cases: [string, string, unknown][] = [
      ["absent", "yes", undefined],
      ["absent", "no", undefined],
      ["absent", "", { a: 1 }],
      ["installed", "remove", installed],
      ["bogus", "yes", { a: 1 }],
    ];
    for (const [st, an, initial] of cases) {
      differential(rig(initial, co), apply("gemini", st, an));
    }
  });

  test("installed with any other answer keeps (injected), then rewrites; a failed keep stops there", () => {
    const co = checkout();
    const r = rig(configOf("claude", [cap(co, "claude", "sh")]), co);
    const calls: string[] = [];
    const keep = (rc: number) => (o: { settingsPath: string }) => (calls.push(o.settingsPath), rc);
    const o = {
      ctx: runCtx(co).ctx,
      cli: "claude",
      settingsPath: r.cfgT,
      repoDir: co,
      state: "installed",
      answer: "keep",
      deps: { spawn: floorOk },
    };
    assert.equal(usageCaptureApply({ ...o, keep: keep(1) }), 1);
    assert.ok(fs.readFileSync(r.cfgT, "utf8").includes("usage-capture.sh"));
    assert.equal(usageCaptureApply({ ...o, keep: keep(0) }), 0);
    assert.deepEqual(calls, [r.cfgT, r.cfgT]);
    assert.ok(!fs.readFileSync(r.cfgT, "utf8").includes("usage-capture.sh"));
  });

  test("below the floor nothing is written, but remove does not depend on Node.js", () => {
    const co = checkout();
    const r = rig(configOf("claude", [cap(co, "claude")]), co);
    const low: Spawner = () => ({ status: 1, stdout: "", stderr: "floor\n" });
    const deps = { spawn: low, floorGuard: import.meta.filename };
    const o = { ctx: runCtx(co).ctx, cli: "claude", settingsPath: r.cfgT, repoDir: co, deps };
    const before = fs.readFileSync(r.cfgT, "utf8");
    assert.equal(usageCaptureApply({ ...o, state: "absent", answer: "yes" }), 1);
    assert.equal(usageCaptureApply({ ...o, state: "installed", answer: "keep", keep: () => 0 }), 1);
    assert.equal(fs.readFileSync(r.cfgT, "utf8"), before);
    assert.equal(usageCaptureApply({ ...o, state: "installed", answer: "remove" }), 0);
    const after = JSON.parse(fs.readFileSync(r.cfgT, "utf8")) as Record<string, unknown>;
    assert.equal(captureFootprint("claude", after).length, 0);
  });
});

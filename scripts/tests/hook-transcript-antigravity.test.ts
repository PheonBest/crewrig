// hook-transcript-antigravity.test.ts — the `crewrig-mempalace-transcript`
// named hook of Antigravity CLI's hooks.json (spec 0247 R23(c), R25, R26,
// delta-01 R24 and scenario "Other arguments are never a transcript command";
// seat finding v1-F2).
//
// Enable path, through both routes the setup can take: the whole
// `deploy_antigravity_transcript_hooks` (retired scripts/lib/common.sh) and its
// `hook-wiring.ts transcript antigravity-merge` step alone. Per event: an event
// holding a foreign-prefix command keeps it and every other element, loses the
// own transcript commands and gets nothing added; every other event takes the
// manifest's array or goes. Decline path: `transcript antigravity-rewrite`, as
// `transcript_rewrite_installed antigravity` runs it. POSIX only for the Bash legs.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import { serialiseJson } from "../lib/hook-config.ts";
import { backups, handler, mode, wiring, type Json } from "./lib/guard-wiring-fixtures.ts";
import {
  AGY_GUARD,
  AGY_HOOK,
  agyCommands,
  agyDirect,
  homeWithCopies,
  makeTranscriptCheckout,
  q,
  type TranscriptCheckout,
} from "./lib/transcript-fixtures.ts";
import { cleanupAll, read, realTmp, SKIP_POSIX } from "./lib/worktree-fixtures.ts";

after(cleanupAll);

const OPERATOR_HOOK = {
  "operator-audit": { Stop: [handler("/opt/audit/log.sh", { timeout: 3 })] },
};
const manifestStop = (co: TranscriptCheckout): Json[] => [
  handler(agyDirect(co, "Stop"), { timeout: 10 }),
];

/** The two enable routes; each returns the hooks.json after the run, and the run's output. */
const ROUTES = {
  "antigravity-merge"(co: TranscriptCheckout, target: string): string {
    const rendered = path.join(realTmp("crewrig-agy-rendered-"), "rendered.json");
    const render = wiring(
      "transcript",
      "render",
      "antigravity",
      "--manifest",
      co.manifest("antigravity"),
      "--repo",
      co.repo,
    );
    assert.equal(render.status, 0, render.stderr);
    fs.writeFileSync(rendered, render.stdout);
    const res = wiring(
      "transcript",
      "antigravity-merge",
      "--hooks",
      target,
      "--manifest",
      rendered,
      "--repo",
      co.repo,
    );
    assert.equal(res.status, 0, res.stderr);
    return res.stdout + res.stderr;
  },
} as const;

function writeHooks(co: TranscriptCheckout, config: Json): string {
  const target = path.join(path.dirname(co.repo), "hooks.json");
  fs.writeFileSync(target, serialiseJson(config), { mode: 0o644 });
  return target;
}

describe("R23(c): the enable path, per event of the named hook", { skip: SKIP_POSIX }, () => {
  for (const [route, run] of Object.entries(ROUTES)) {
    test(`${route}: an event with a foreign-prefix command keeps it and every other element, loses the own ones, gets nothing`, () => {
      const co = makeTranscriptCheckout();
      const c = agyCommands(homeWithCopies());
      const stop = [
        handler(c.enabled, { timeout: 10 }),
        handler(c.foreign, { timeout: 11 }),
        handler("/opt/operator/after-turn.sh"),
        handler(c.otherArgs),
        handler(`node "/old/hooks/mempalace-transcript.ts" antigravity-cli Stop`),
        { matcher: "x", hooks: [handler(c.unmarked)] },
        { matcher: "y", hooks: [handler(c.disabled), handler(c.otherArgsStop)] },
      ];
      const target = writeHooks(co, { [AGY_HOOK]: { Stop: stop }, ...OPERATOR_HOOK });
      const report = run(co, target);
      const after = JSON.parse(read(target)) as Json;
      assert.deepEqual((after[AGY_HOOK] as Json)["Stop"], [
        handler(c.foreign, { timeout: 11 }),
        handler("/opt/operator/after-turn.sh"),
        handler(c.otherArgs),
        { matcher: "y", hooks: [handler(c.otherArgsStop)] },
      ]);
      assert.deepEqual(
        after["operator-audit"],
        OPERATOR_HOOK["operator-audit"],
        "another named hook byte-identical",
      );
      assert.match(report, /MEMPALACE_MCP_PORT=\.\.\..*nothing added on this event/);
      assert.doesNotMatch(report, /41999/);
      assert.equal(mode(target), 0o600);
    });

    test(`${route}: every other event takes the manifest's array or goes, other elements and other-argument commands with it`, () => {
      const co = makeTranscriptCheckout();
      const c = agyCommands(homeWithCopies());
      const target = writeHooks(co, {
        ...OPERATOR_HOOK,
        [AGY_HOOK]: {
          PreInvocation: [
            handler(c.enabled.replace(" Stop", " PreInvocation")),
            handler(c.otherArgs),
            handler("/opt/x.sh"),
          ],
          Stop: [handler(c.enabled), handler(c.otherArgsStop), handler("/opt/y.sh")],
        },
      });
      run(co, target);
      const after = JSON.parse(read(target)) as Json;
      assert.deepEqual(after[AGY_HOOK], { Stop: manifestStop(co) });
      assert.deepEqual(
        Object.keys(after).slice(0, 2),
        ["operator-audit", AGY_HOOK],
        "key order kept",
      );
    });

    test(`${route}: an event the manifest no longer registers keeps its foreign-prefix command and other elements`, () => {
      const co = makeTranscriptCheckout();
      const c = agyCommands(homeWithCopies());
      const foreign = c.foreign.replace(" Stop", " PreInvocation");
      const target = writeHooks(co, {
        [AGY_HOOK]: {
          PreInvocation: [
            handler(foreign),
            handler(c.enabled.replace(" Stop", " PreInvocation")),
            handler(c.otherArgs),
          ],
        },
      });
      run(co, target);
      const after = JSON.parse(read(target)) as Json;
      assert.deepEqual(after[AGY_HOOK], {
        Stop: manifestStop(co),
        PreInvocation: [handler(foreign), handler(c.otherArgs)],
      });
    });
  }

  test("antigravity-merge: a non-object hooks.json is refused and left byte-identical", () => {
    const co = makeTranscriptCheckout();
    const target = path.join(path.dirname(co.repo), "hooks.json");
    fs.writeFileSync(target, "[1]\n");
    const rendered = path.join(path.dirname(co.repo), "rendered.json");
    fs.writeFileSync(rendered, JSON.stringify({ [AGY_HOOK]: { Stop: manifestStop(co) } }));
    const res = wiring(
      "transcript",
      "antigravity-merge",
      "--hooks",
      target,
      "--manifest",
      rendered,
      "--repo",
      co.repo,
    );
    assert.equal(res.status, 1);
    assert.equal(read(target), "[1]\n");
    assert.deepEqual(backups(target), []);
  });
});

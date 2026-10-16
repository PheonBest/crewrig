// usage-dashboard-empty.test.ts — case 13.11 of the usage dashboard suite (spec 0210 R10; replaces the
// matching group of test-usage-dashboard.sh, spec 0260 row J1a): the no-match, store-empty, pruned-store
// and superseded-only empty states read the same in the four forms and their banners stay distinct.

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import { after, describe, test } from "node:test";

import { checkCells, decodeEntities } from "./lib/usage-dashboard-cells.ts";
import { partition } from "./lib/usage-dashboard-checks.ts";
import {
  dash,
  drv,
  expected,
  freshSandbox,
  PRICING,
  REPO,
  runEntry,
  threeForms,
  type Forms,
  type Sandbox,
} from "./lib/usage-dashboard-rig.ts";
import { formsB, startServer, type FormsB, type Server } from "./lib/usage-dashboard-serve.ts";
import { groupDiff, type Session, type View } from "./lib/usage-dashboard-views.ts";
import { cleanupAll, realTmp } from "./lib/worktree-fixtures.ts";

const out = realTmp("ud-render-");
const servers: Server[] = [];
after(async () => {
  for (const s of servers)
    assert.equal((await s.stop()).viaStop, true, "POST /stop ends the server");
  cleanupAll();
});
async function withForms(
  sb: Sandbox,
  label: string,
  filters: string[],
): Promise<{ f: Forms; b: FormsB; server: Server }> {
  const server = await startServer(sb);
  servers.push(server);
  const f = threeForms(sb, out, label, filters);
  const b = await formsB(server, filters);
  assert.deepEqual([...f.errors, ...b.errors], [], `${label}: every form yields a view model`);
  return { f, b, server };
}
const session = (v: View, id: string): Session | undefined =>
  v.sessions.find((s) => s.sessionId === id);

describe("13.11 empty states (R10)", () => {
  async function empty(
    label: string,
    sb: Sandbox,
    want: string,
    banner: string,
    filters: string[] = [],
  ) {
    const { f, b } = await withForms(sb, "e" + label.replace(/\W/g, ""), filters);
    for (const [form, v] of [
      ["A", f.A!],
      ["C", f.C!],
      ["B", b.B!],
      ["Bv", b.Bv!],
    ] as const) {
      assert.equal(v.empty, want, `13.11 [${label}] form ${form}: empty = "${want}"`);
      assert.deepEqual(partition(v).errs, []);
    }
    assert.equal(
      dash(["report", ...filters], sb).status,
      0,
      `13.11 [${label}] form C exits 0 (an empty result is not an error)`,
    );
    assert.equal(b.Bstatus, 200, `13.11 [${label}] form B answers 200`);
    for (const [form, text] of [
      ["A", f.Ahtml],
      ["B", b.Bhtml],
      ["C", f.Ctext],
    ] as const)
      assert.ok(
        text.includes(banner),
        `13.11 [${label}] form ${form} shows the banner "${banner}"`,
      );
    return f.Ctext;
  }
  const STORE = "The usage store holds no record";
  const SUP = "superseded by a later snapshot of the same session";
  const pinOnly = (): Sandbox => {
    const sb = freshSandbox("empty");
    drv("pin-only", [PRICING], sb.env);
    return sb;
  };

  test("13.11 [no-match] and [store-empty]: forms agree and the two banners are distinct", async () => {
    const a = await empty(
      "no-match",
      freshSandbox(),
      "no-match",
      "No record matches this selection",
      ["--session", "no-such-session"],
    );
    const c = await empty("store-empty", pinOnly(), "store-empty", STORE);
    assert.ok(
      !a.includes(STORE) && !c.includes("No record matches this selection"),
      "13.11 the no-match and store-empty banners are distinct",
    );
  });
  test("13.11b pruned store (v2-F2): leftover empty journal/<cli>/<YYYY-MM> directories read as store-empty", async () => {
    const sb = freshSandbox();
    const clis = fs.readdirSync(path.join(sb.root, "journal"));
    for (const cli of clis)
      for (const m of fs.readdirSync(path.join(sb.root, "journal", cli)))
        assert.equal(runEntry("usage-prune", [cli, m, "--force"], sb).status, 0);
    const walk = (d: string): string[] =>
      fs
        .readdirSync(d, { withFileTypes: true })
        .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [e.name]));
    const left = walk(path.join(sb.root, "journal")).filter(
      (n) => n.endsWith(".json") && !/\.(wing|attr)\.json$/.test(n),
    );
    assert.deepEqual(left, [], "13.11b setup: the prune removed every entry");
    assert.ok(
      clis.some((c) => fs.readdirSync(path.join(sb.root, "journal", c)).length > 0),
      "13.11b setup: journal/<cli>/<YYYY-MM>/ directories are left behind",
    );
    await empty("pruned store (v2-F2)", sb, "store-empty", STORE);
  });
  test("13.11c superseded-only (v2-F1): banner, snapshot count, never No record matches; --session variant", async () => {
    const n = expected("supersededOnlyDay", "matchingSnapshots");
    const day = ["--from", "2026-09-20", "--to", "2026-09-20"];
    const sb = freshSandbox();
    const { f, b } = await withForms(sb, "sup", day);
    for (const [form, text] of [
      ["A", f.Ahtml],
      ["B", b.Bhtml],
      ["C", f.Ctext],
    ] as const)
      assert.match(
        text,
        new RegExp(`(^|[^0-9])${n} session-cumulative snapshot`),
        `13.11c form ${form} counts the ${n} matching superseded snapshots`,
      );
    await empty("superseded-only (v2-F1)", sb, "superseded-only", SUP, day);
    const c = await empty("superseded-only, session selector (v2-F1)", sb, "superseded-only", SUP, [
      "--session",
      "sess-s1",
      ...day,
    ]);
    assert.ok(
      !f.Ctext.includes("No record matches this selection") &&
        !c.includes("No record matches this selection"),
      "13.11c superseded-only never claims that no record matches",
    );
  });
});

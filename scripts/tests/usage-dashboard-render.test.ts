// usage-dashboard-render.test.ts — cases 13.9, 13.10, 13.11, 13.18, 13.19, D6 and i1-F1 of the usage
// dashboard suite (spec 0210 R26-R30; replaces the matching groups of test-usage-dashboard.sh, spec 0260
// row J1a): the mixed marker, the sub-agent drill-down, the empty states of the four forms, no leaked
// conversation text, a stable text report, refused arguments and a --session view that keeps its subtree.

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

describe("13.9 / 13.10 mixed fidelities and the sub-agent drill-down", () => {
  const sb = freshSandbox();
  test("13.9 the task rollup carries mixed = [per-request, session-cumulative]; every form prints the marker", async () => {
    const { f, b } = await withForms(sb, "mixed", ["--task-key", "task-mixed"]);
    const want = ["per-request", "session-cumulative"];
    const task = f.C!.tasks.find((t) => t.taskHandoffKey === "task-mixed");
    assert.deepEqual(
      [f.C!.totals.tokens.combined.mixed, f.C!.totals.price.mixed, task?.tokens.combined.mixed],
      [want, want, want],
    );
    const fmt = createRequire(import.meta.url)(
      path.join(REPO, "scripts/lib/usage-dashboard/format.js"),
    ) as { mixed(v: string[]): string };
    const marker = fmt.mixed(want);
    assert.ok(marker.includes("per-request") && marker.includes("session-cumulative"), marker);
    for (const [form, text] of [
      ["A", f.Ahtml],
      ["B", b.Bhtml],
      ["C", f.Ctext],
    ] as const)
      assert.ok(text.includes(marker), `13.9 form ${form} prints the mixed marker "${marker}"`);
    for (const [form, html] of [
      ["A", f.Ahtml],
      ["B", b.Bhtml],
    ] as const) {
      const row =
        /<tr\b[^>]*>(?:(?!<\/tr>)[\s\S])*data-k="totals\.tokens\.combined\.netInput"(?:(?!<\/tr>)[\s\S])*<\/tr>/.exec(
          html,
        );
      assert.ok(
        row?.[0].includes(marker),
        `13.9 form ${form}: the combined totals row carries the mixed marker`,
      );
    }
  });
  test("13.10 a session with no agent keeps agents: [], a parent lists its agent; No subordinate agent in A, B, C", async () => {
    const { f, b } = await withForms(sb, "whole", []);
    for (const [form, v] of [
      ["A", f.A!],
      ["C", f.C!],
      ["B", b.B!],
    ] as const)
      assert.deepEqual(
        [
          session(v, "sess-alpha")?.agents,
          session(v, "sess-parent")?.agents.some((a) => a.agentId === "agent-reviewer"),
        ],
        [[], true],
        `13.10 form ${form}`,
      );
    for (const [form, text] of [
      ["A", f.Ahtml],
      ["B", b.Bhtml],
      ["C", f.Ctext],
    ] as const)
      assert.ok(
        text.includes("No subordinate agent") && text.includes("sess-alpha"),
        `13.10 form ${form} shows sess-alpha with "No subordinate agent"`,
      );
  });
});

describe("13.18 / 13.19 / D6 / i1-F1", () => {
  const sb = freshSandbox();
  test("13.18 no raw, uncapturedReason or projectRoot content reaches any output of A, B or C", async () => {
    const leak =
      /SENTINEL-CONVERSATION-TEXT|SENTINEL-PROJECT-ROOT|transcriptExcerpt|uncapturedReason|rawStatus/;
    for (const [label, filters] of [
      ["whole", []],
      ["gaps", ["--session", "sess-gaps"]],
    ] as const) {
      const { f, b } = await withForms(sb, label, [...filters]);
      for (const [name, text] of [
        ["A.html", f.Ahtml],
        ["C.json", JSON.stringify(f.C)],
        ["C.txt", f.Ctext],
        ["Bpage", b.Bhtml],
        ["Bview", JSON.stringify(b.Bv)],
      ] as const) {
        assert.ok(text.length > 20, `${label}.${name}: empty or missing`);
        assert.doesNotMatch(text, leak, `${label}.${name}`);
      }
    }
  });
  test("13.19 two runs are identical after dropping Generated; no ESC; fixed column and section order", () => {
    const r1 = dash(["report"], sb).stdout;
    const r2 = dash(["report"], sb).stdout;
    const keep = (s: string): string =>
      s
        .split("\n")
        .filter((l) => !l.includes("Generated"))
        .join("\n");
    assert.ok(
      r1.length > 0 && keep(r1) === keep(r2),
      "13.19 two runs are byte-identical after dropping the Generated line",
    );
    assert.ok(!r1.includes("\x1b"), "13.19 no ESC byte in the text report");
    const header = r1
      .split("\n")
      .find((l) => /^\s*key\s*\|/.test(l))
      ?.replace(/ /g, "");
    assert.equal(
      header,
      "key|records|uncaptured|netInput|cacheRead|cacheWrite|output|reasoning|fidelity|price|priced|unpriced|unconverted",
    );
    const sections = [...r1.matchAll(/^== (.*) ==$/gm)].map((m) => m[1]).join("|") + "|";
    assert.match(
      sections,
      /^Selection\|Pricing\|Totals\|By (day|week|month)[^|]*\|By CLI\|By model\|Sessions[^|]*\|Tasks\|Assets\|$/,
    );
  });
  for (const flag of [
    "--undrained",
    "--pending",
    "--rollup",
    "--combined",
    "--period 2026-9",
    "--bucket year",
    "--from 2026-10-02 --to 2026-10-01",
    "--agent a",
  ])
    test(`D6 report ${flag} exits 2 with FATAL`, () => {
      const r = dash(["report", ...flag.split(" ")], sb);
      assert.equal(r.status, 2, `exit ${r.status}: ${r.stderr.slice(0, 200)}`);
      assert.match(r.stdout + r.stderr, /FATAL/);
    });
  test("i1-F1 --session sess-parent keeps its subtree: equal agents, totals, tallies, drill-down and cells in A, C, B, Bv", async () => {
    const sid = "sess-parent";
    const whole = dash(["report", "--json"], sb).stdout;
    const a = session(JSON.parse(whole) as View, sid)!;
    assert.ok(a && a.agents.length > 0, `fixture precondition: ${sid} has agents`);
    const { f, b } = await withForms(sb, "sub", ["--session", sid]);
    for (const [form, v] of [
      ["A", f.A!],
      ["C", f.C!],
      ["B", b.B!],
      ["Bv", b.Bv!],
    ] as const) {
      const s = session(v, sid)!;
      assert.equal(groupDiff(a, s), null, `i1-F1 form ${form}: sessions[${sid}]`);
      assert.deepEqual(
        s.agents.map((x) => x.agentId),
        a.agents.map((x) => x.agentId),
        `i1-F1 form ${form} agents`,
      );
      a.agents.forEach((x, i) =>
        assert.equal(groupDiff(x, s.agents[i]), null, `agent ${x.agentId}`),
      );
    }
    for (const [form, text] of [
      ["A", f.Ahtml],
      ["B", b.Bhtml],
      ["C", f.Ctext],
    ] as const) {
      let block: string | undefined;
      if (form === "C") {
        const lines = text.split("\n");
        const i = lines.findIndex((l) => l.startsWith(`session ${sid} `));
        let j = i + 1;
        while (
          i >= 0 &&
          j < lines.length &&
          !/^session /.test(lines[j]!) &&
          !/^== /.test(lines[j]!)
        )
          j += 1;
        block = i < 0 ? undefined : lines.slice(i, j).join("\n");
      } else
        block = [
          ...text.matchAll(
            /<details><summary>Session <code>([\s\S]*?)<\/code>[\s\S]*?<\/details>/g,
          ),
        ].find((m) => decodeEntities(m[1]!) === sid)?.[0];
      assert.ok(block, `i1-F1 form ${form}: no drill-down block for ${sid}`);
      assert.ok(
        !block.includes("No subordinate agent") && block.includes("agent-reviewer"),
        `i1-F1 form ${form} renders ${sid}'s agents, never "No subordinate agent"`,
      );
      const rows =
        form === "C"
          ? block.split("\n").filter((l) => l.startsWith("agent-reviewer ")).length
          : (block.match(/data-k="sessions\.\d+\.agents\.\d+\.recordCount"/g) ?? []).length;
      assert.equal(rows, form === "C" ? 1 : a.agents.length, `i1-F1 form ${form} agent rows`);
    }
    for (const [form, html, v] of [
      ["A", f.Ahtml, f.A!],
      ["B", b.Bhtml, b.B!],
    ] as const)
      assert.deepEqual(
        checkCells(html, v).errs,
        [],
        `i1-F1 form ${form}: every rendered figure, drill-down included, equals format(value)`,
      );
  });
});

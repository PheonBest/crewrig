// audit-termination.test.ts — the R25 termination audit tool (spec 0266 R19) against a mkdtemp
// fixture repository and a stubbed `gh`. Real git, no network, nothing outside the fixture.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { classify } from "../lib/audit-termination/classify.ts";
import { collectGaps, matrixRow } from "../lib/audit-termination/gaps.ts";
import { refsOf } from "../lib/audit-termination/issues.ts";
import { buildReport } from "../lib/audit-termination/report.ts";
import { rehearse } from "../lib/audit-termination/rehearsal.ts";
import { lineKinds } from "../lib/audit-termination/shell-scan.ts";
import { windowsJobs } from "../lib/audit-termination/checklist.ts";
import type { Deps, Run } from "../lib/audit-termination/types.ts";
import { makeLog } from "../lib/audit-termination/types.ts";

const NM = "❓ **NOT MEASURED**";
const matrix = (c37: string): string =>
  [
    "| # | Feature | Source | Claude Code | Gemini CLI | Copilot CLI | Antigravity CLI |",
    "|---|---|---|---|---|---|---|",
    `| 37g | Windows plugin-root | src | ${c37} | ${NM} a | ${NM} b | ${NM} c |`,
    `| 42 | Missing hook | src | ${NM} | ${NM} | measured fine | ${NM} |`,
    "",
  ].join("\n");

const ISSUES: Record<number, object> = {
  1500: { number: 1500, title: "closed follow-up", state: "closed", assignees: [] },
  1501: { number: 1501, title: "open follow-up", state: "open", assignees: [{ login: "alice" }] },
  1502: { number: 1502, title: "a pull request", state: "closed", assignees: [], pull_request: {} },
  1503: { number: 1503, title: "found by search", state: "closed", assignees: [] },
  1601: { number: 1601, title: "Windows measurement", state: "open", assignees: [] },
  1693: { number: 1693, title: "still open", state: "open", assignees: [{ login: "bob" }] },
};

const stubGh = (args: readonly string[]): { status: number; stdout: string; stderr: string } => {
  const ok = (v: unknown) => ({ status: 0, stdout: JSON.stringify(v), stderr: "" });
  const j = args.join(" ");
  if (j.startsWith("issue view 1231")) {
    return ok({
      body: "| row | spec |\n| A | specs/0300-child.md |\n| B | `specs/0999-gone.md` |\n\nSee #1500 and #1400.",
      comments: [{ body: "follow-up #1501 and PR #1502, also #1231" }],
    });
  }
  if (j.startsWith("issue view 1344")) return ok({ body: "", comments: [] });
  if (j.startsWith("issue list")) return ok([{ number: 1503 }, { number: 1501 }]);
  const m = /^api repos\/crewrig\/crewrig\/issues\/(\d+)$/.exec(j);
  if (m !== null) {
    const issue = ISSUES[Number(m[1])];
    return issue === undefined ? { status: 1, stdout: "", stderr: "404" } : ok(issue);
  }
  return { status: 1, stdout: "", stderr: `unstubbed gh ${j}` };
};

let tmp = "";
let repo = "";
let c1 = "";
let c2 = "";

const git = (args: string[], cwd = repo): string => {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], {
    cwd,
    encoding: "utf8",
  });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};
const put = (rel: string, text: string): void => {
  mkdirSync(dirname(join(repo, rel)), { recursive: true });
  writeFileSync(join(repo, rel), text);
};

const deps = (): Deps => {
  const logger = makeLog();
  const run: Run = (cmd, args, cwd) => {
    logger.log(`${cmd} ${args.join(" ")}`);
    if (cmd === "gh") return stubGh(args);
    const r = spawnSync("git", [...args], { cwd, encoding: "utf8" });
    return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  };
  return { root: repo, run, log: logger.log, lines: logger.lines, tmpBase: tmp };
};

before(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), "audit-term-test-")));
  repo = join(tmp, "repo");
  mkdirSync(repo);
  git(["init", "--quiet", "-b", "main"]);
  put(
    "specs/0215-shell-to-typescript-migration.md",
    '---\nid: "0215"\nstatus: approved\nrelated-issue: 1231\nversion: 1.0.0\n---\n',
  );
  put(
    "specs/0300-child.md",
    '---\nid: "0300"\nstatus: implemented\nrelated-issue: 1400\nversion: 1.1.0\n---\nParent: specs/0215-shell-to-typescript-migration.md\n',
  );
  put(
    "specs/0301-other.md",
    '---\nid: "0301"\nstatus: draft\nrelated-issue: 1\nversion: 1.0.0\n---\nunrelated\n',
  );
  put("docs/cli-matrix.md", matrix(NM));
  put("ci/shell-allowlist.txt", "# header\nscripts/legacy.sh\n");
  put("scripts/legacy.sh", "#!/usr/bin/env bash\necho hi\n");
  put("scripts/tool", "#!/bin/sh\necho hi\n");
  put(
    "docs/note.md",
    "Run bash scripts/legacy.sh to start.\nThe `scripts/old.sh` shim was removed.\nplain prose, push it\n",
  );
  put("docs/shell-removal.md", "| scripts/old.sh | removed |\n");
  put(
    ".github/workflows/build.yml",
    "jobs:\n  windows-a:\n    runs-on: windows-latest\n  lint:\n    name: Windows lint\n    runs-on: ubuntu-latest\n  plain:\n    runs-on: ubuntu-latest\n",
  );
  put("scripts/sync-from-upstream.sh", "#!/usr/bin/env bash\necho sync\n");
  git(["add", "-A"]);
  git(["commit", "--quiet", "-m", "c1"]);
  c1 = git(["rev-parse", "HEAD"]);
  git(["rm", "--quiet", "scripts/sync-from-upstream.sh"]);
  git(["commit", "--quiet", "-m", "c2"]);
  c2 = git(["rev-parse", "HEAD"]);
  git(["update-ref", "refs/remotes/origin/main", c1]);
  git(["update-ref", "refs/remotes/origin/release/1231-ts-migration", c2]);
});

after(() => {
  if (tmp !== "" && tmp.startsWith(tmpdir().length > 0 ? realpathSync(tmpdir()) : "/"))
    rmSync(tmp, { recursive: true, force: true });
});

describe("pure helpers", () => {
  it("extracts #N references and not anchors or paths", () => {
    assert.deepEqual(refsOf("see #12, (#34) and a/#5 and x&#9; and #100"), [12, 34, 100]);
  });
  it("finds the matrix row cells", () => {
    const row = matrixRow(matrix(NM), "37g");
    assert.equal(row?.length, 7);
    assert.match(row?.[3] ?? "", /NOT MEASURED/);
  });
  it("detects bash/sh words and .sh suffix", () => {
    assert.deepEqual(lineKinds("run bash x"), ["bash/sh word"]);
    assert.deepEqual(lineKinds("a.sh then sh -c"), ["bash/sh word", ".sh"]);
    assert.deepEqual(lineKinds("push the fish. shell"), []);
  });
  it("classifies the historical-record and third-party families by rules H5 to H11", () => {
    assert.equal(classify("docs/adr/0001-x.md", "bash run.sh").rule, "H5");
    assert.equal(classify(".claude/skills/gitlab-ci/SKILL.md", "- ./scripts/deploy.sh").rule, "H6");
    assert.equal(
      classify("docs/runbooks/extension-mcp-token-probe.md", "x dist/stub.sh y").rule,
      "H7",
    );
    assert.equal(classify("README.md", "curl -sL https://taskfile.dev/install.sh | sh").rule, "H8");
    assert.equal(classify("docs/a.md", "reads ~/.crewrig/tls-env.sh").rule, "H9");
    assert.equal(classify("docs/assets/mempalace-mcp/rotate-token.prompt.md", "x.sh").rule, "H10");
    assert.equal(classify("docs/cli-matrix.md", "Git for Windows bash.exe").rule, "H11");
    assert.equal(classify("README.md", "bash scripts/x.sh").label, "UNCLASSIFIED");
  });

  it("classifies only by the listed rules", () => {
    assert.deepEqual(classify("docs/shell-removal.md", "bash x.sh"), {
      label: "historical",
      rule: "H1",
    });
    assert.deepEqual(classify("docs/a.md", "The `x.sh` shim was removed."), {
      label: "historical",
      rule: "H3",
    });
    assert.equal(classify("docs/a.md", "Run bash x.sh").label, "UNCLASSIFIED");
  });
  it("lists windows jobs by id, name and runs-on", () => {
    const y =
      "jobs:\n  windows-a:\n    runs-on: windows-latest\n  lint:\n    name: Windows lint\n  c:\n    runs-on: windows-latest\n  d:\n    runs-on: ubuntu-latest\n";
    assert.deepEqual(windowsJobs(y), [
      "windows-a",
      "lint (name: Windows lint)",
      "c (runs-on windows)",
    ]);
  });
});

describe("collectGaps", () => {
  it("passes when every row 37g cell is NOT MEASURED and counts row 42", () => {
    const g = collectGaps(deps());
    assert.deepEqual(g.facts.failures, []);
    assert.equal(g.facts.row42NotMeasured, 3);
    assert.match(g.markdown, /forge assignee: \(none assigned on the forge\)/);
    assert.match(g.markdown, /#1693 is open: still open\. Owner \(forge assignee\): @bob/);
  });
  it("FAILS the self-check when a row 37g cell reads measured", () => {
    put("docs/cli-matrix.md", matrix("✅ verified on Windows"));
    const g = collectGaps(deps());
    assert.equal(g.facts.failures.length, 1);
    assert.match(g.facts.failures[0] ?? "", /Claude Code/);
    put("docs/cli-matrix.md", matrix(NM));
  });
});

describe("rehearse", () => {
  it("proves ancestry, the shell blob and the local merge in a clone, leaving no directory", () => {
    const d = deps();
    const before = readdirSync(tmp).sort();
    const r = rehearse(d, { mergeRehearsal: true, commits: [c1, c2] });
    assert.deepEqual(readdirSync(tmp).sort(), before);
    assert.deepEqual(r.facts.failures, []);
    assert.match(r.markdown, /restores shell text/);
    assert.match(r.markdown, /first line `#!\/usr\/bin\/env bash`/);
    assert.ok(d.lines().some((l) => l.includes("clone --no-local")));
    assert.ok(d.lines().some((l) => l.includes("merge-base --is-ancestor")));
  });
  it("reports FAIL for a commit that is not an ancestor", () => {
    const r = rehearse(deps(), {
      mergeRehearsal: false,
      commits: [c2, c1],
      releaseRef: "origin/main",
    });
    assert.equal(r.facts.failures.length, 2);
  });
});

describe("buildReport", () => {
  it("assembles the sections with real counts from the fixture", () => {
    const r = buildReport(deps(), false, new Date("2026-01-01T00:00:00Z"));
    const md = r.markdown;
    assert.match(md, /Totals by status: approved=1, implemented=1 \(2 specs\)/);
    assert.match(
      md,
      /Spec paths named in the epic body table but not tracked: specs\/0999-gone\.md/,
    );
    assert.doesNotMatch(md, /0301-other/);
    assert.match(md, /Issues: 3 \(open 1, closed 2, other 0\); pull requests referenced: 1/);
    assert.match(md, /\| #1501 \| open follow-up \| open \| @alice/);
    assert.match(md, /`\*\.sh` 1; shebang without the suffix 1; total 2/);
    assert.match(md, /ci\/shell-allowlist\.txt` entries \(non-blank, non-comment lines\): 1/);
    assert.match(md, /docs\/note\.md:1 \| bash\/sh word \+ \.sh \| UNCLASSIFIED/);
    assert.match(md, /docs\/note\.md:2 \| \.sh \| historical \| H3/);
    assert.match(md, /UNCLASSIFIED 1\./);
    assert.match(md, /\| Ratchet allowlist is empty \| NOT MET/);
    assert.match(md, /\| Every sub-spec carries `status: implemented` \| NOT MET/);
    assert.match(md, /NEEDS-MANUAL-EVIDENCE \| 2 windows jobs.*Verify on the release head run/);
    assert.match(md, /## Command log/);
    // the real sync commits do not exist in the fixture: the rehearsal must fail loudly
    assert.ok(r.failures.some((f) => f.includes("is an ancestor")));
  });
});

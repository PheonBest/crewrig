// Black-box test of the extension-hook probe (spec 0261 R11): `scripts/probe-extension-hooks` is
// driven through stand-in vendor executables only, as the `.sh` today and as the `.ts` twin later,
// with this file unchanged. Copilot outcome classes: B1A (a hook fired), B2 (nothing fired, rc 0),
// B3 (the call failed). B1B does not exist in the probe's verdict, so it cannot be driven.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  copilotStandIn,
  hostLacksProbeTools,
  runProbe,
  shStandIn,
  type CopilotMode,
  type ProbeRun,
} from "./lib/e2e-probe-blackbox.ts";

const SCRIPT = "probe-extension-hooks";
const AGY_DOC = ".gemini/antigravity-cli/builtin/skills/agy-customizations/docs/hooks.md";
const AGY_DOC_TEXT =
  "The working directory is set to the directory containing hooks.json.\nDefaults to `30` seconds.\n";
const CLAUDE_EVIDENCE = '# "hooks": {\n# CLAUDE_PLUGIN_ROOT\n';

interface Options {
  readonly missing?: readonly string[];
  readonly copilot?: CopilotMode;
  readonly claudeEvidence?: boolean;
  readonly agyDoc?: boolean;
}

type Leg = "shell" | "entry";
const LEGS: readonly Leg[] = ["shell", "entry"];

function probeOn(leg: Leg, o: Options = {}): ProbeRun {
  return runProbe((calls) => {
    const all: Record<string, string> = {
      claude: shStandIn(
        "claude",
        calls,
        "2.1.0 (Claude Code)",
        o.claudeEvidence === false ? "" : CLAUDE_EVIDENCE,
      ),
      gemini: shStandIn("gemini", calls, "0.9.0"),
      agy: shStandIn("agy", calls, "1.2.3"),
      copilot: copilotStandIn(calls, o.copilot ?? "root"),
    };
    for (const name of o.missing ?? []) delete all[name];
    return {
      script: SCRIPT,
      leg,
      standIns: all,
      homeFiles: (o.agyDoc === false ? {} : { [AGY_DOC]: AGY_DOC_TEXT }) as Record<string, string>,
    };
  });
}

/** The probe wrote nothing under the scratch HOME beyond what the case seeded, and no usage record. */
function assertClean(run: ProbeRun, seeded: readonly string[] = []): void {
  assert.deepEqual(Object.keys(run.files).sort(), seeded.map((s) => `home/${s}`).sort());
  assert.deepEqual(run.tmpLeft, [], "the probe must remove its own scratch directory");
}

/** The shell prints the R10 line on BSD grep only (GNU reads the backtick pattern as an anchor). */
const withoutR10 = (text: string): string => text.replace(/^ {2}R10 time-unit check.*\n/m, "");

for (const leg of LEGS)
  describe(`probe-extension-hooks black box (${leg} leg)`, { skip: hostLacksProbeTools() }, () => {
    const probe = (o: Options = {}): ProbeRun => probeOn(leg, o);
    describe("all four CLIs present", () => {
      it("B1A when the root hooks.json fires: verdict, extra probes, exit 0, nothing left", () => {
        const run = probe({ copilot: "root" });
        assert.equal(run.status, 0, run.stderr);
        assert.match(run.stdout, /--- Claude Code ---/);
        assert.match(run.stdout, /Version \(self-reported\): 2\.1\.0 \(Claude Code\)/);
        assert.match(run.stdout, /Resolved binary: <SCRATCH>\/bin\/claude/);
        assert.match(run.stdout, /R9 envelope check: installed binary's own embedded doc shows/);
        assert.match(run.stdout, /R11 root-token check: CLAUDE_PLUGIN_ROOT confirmed present/);
        assert.match(run.stdout, /--- Gemini CLI ---\n {2}Version \(self-reported\): 0\.9\.0/);
        assert.match(run.stdout, /--- Antigravity CLI ---\n {2}Version \(self-reported\): 1\.2\.3/);
        assert.match(run.stdout, /Evidence: <SCRATCH>\/home\/\.gemini\/antigravity-cli/);
        // The R10 line is not asserted: the probe greps for the pattern 'Defaults to \`30\`', and GNU
        // grep reads `\`` as an anchor where BSD grep reads a backtick, so the shell prints the line on
        // macOS only. The TypeScript twin prints it everywhere (a deviation for spec 0261 to list).
        assert.match(run.stdout, /Version \(self-reported\): 1\.0\.80/);
        assert.match(run.stdout, /copilot exit status: 0/);
        assert.match(run.stdout, /hooks\.json at plugin root fired: {2}yes/);
        assert.match(run.stdout, /hooks\/hooks\.json \(subdir\) fired: {2}no/);
        assert.match(run.stdout, /CWD=<WORK>\/plugin-root-token ROOT=<WORK>\/plugin-root-token/);
        assert.match(run.stdout, /MARKER_BASH/);
        assert.doesNotMatch(run.stdout, /MARKER_NOMATCH/);
        assert.match(run.stdout, /B1A — a Copilot plugin-level hook surface EXISTS/);
        assert.doesNotMatch(run.stdout, /\bB2 —|\bB3 —/);
        assert.match(run.stdout, /Record the outcome in docs\/runbooks\/extension-hook-probe\.md/);
        assert.equal(run.stderr, "");
        assertClean(run, [AGY_DOC]);
      });

      it("B1A when only the subdirectory hooks.json fires", () => {
        const run = probe({ copilot: "subdir" });
        assert.equal(run.status, 0, run.stderr);
        assert.match(run.stdout, /hooks\.json at plugin root fired: {2}no/);
        assert.match(run.stdout, /hooks\/hooks\.json \(subdir\) fired: {2}yes/);
        assert.match(run.stdout, /B1A — /);
        assertClean(run, [AGY_DOC]);
      });

      it("B2 when copilot succeeds and no hook fires: no extra probes, exit 0", () => {
        const run = probe({ copilot: "none" });
        assert.equal(run.status, 0, run.stderr);
        assert.match(run.stdout, /copilot exit status: 0/);
        assert.match(run.stdout, /B2 — absence demonstrated/);
        assert.doesNotMatch(
          run.stdout,
          /B1A|B3 —|Matcher form check|R11 root-token check: probing/,
        );
        assert.equal(run.calls.match(/^copilot <--plugin-dir>/gm)?.length, 1);
        assertClean(run, [AGY_DOC]);
      });

      it("B3 when the copilot call fails: output relayed on stderr, exit 0", () => {
        const run = probe({ copilot: "fail" });
        assert.equal(run.status, 0, "B3 is a probe outcome, not a probe failure");
        assert.match(run.stdout, /copilot exit status: 3/);
        assert.match(run.stdout, /B3 — INCONCLUSIVE: the probe call itself failed \(rc=3\)/);
        assert.match(run.stderr, /boom: simulated copilot failure/);
        assert.doesNotMatch(run.stdout, /B1A|B2 —/);
        assertClean(run, [AGY_DOC]);
      });

      it("invokes copilot with the documented argv and writes no usage record without a usage file", () => {
        const run = probe({ copilot: "root" });
        const lines = run.calls.split("\n").filter((l) => l.startsWith("copilot <--plugin-dir>"));
        assert.equal(lines.length, 3);
        const first = lines[0] ?? "";
        assert.match(
          first,
          /<--plugin-dir> <<WORK>\/plugin-root-hooks> <--plugin-dir> <<WORK>\/plugin-subdir-hooks>/,
        );
        assert.match(first, /<-p> <Run the shell command: echo hello-world-probe>/);
        assert.match(
          first,
          /<--allow-all-tools> <--add-dir> <<WORK>> <--usage-output-file> <<WORK>\/copilot-usage-1\.json>/,
        );
        assert.match(lines[1] ?? "", /<--plugin-dir> <<WORK>\/plugin-root-token> <-p>/);
        assert.match(lines[2] ?? "", /<--plugin-dir> <<WORK>\/plugin-matcher> <-p>/);
        assert.deepEqual(
          Object.keys(run.files).filter((f) => f.startsWith("usage/")),
          [],
        );
      });
    });

    describe("evidence variants", () => {
      it("reports an inconclusive envelope check and no root-token line when claude has no evidence", () => {
        const run = probe({ claudeEvidence: false });
        assert.equal(run.status, 0, run.stderr);
        assert.match(run.stdout, /R9 envelope check: no '"hooks": \{' envelope string found/);
        assert.match(run.stdout, /INCONCLUSIVE, do not assume either shape/);
        assert.doesNotMatch(run.stdout, /R11 root-token check: CLAUDE_PLUGIN_ROOT confirmed/);
      });

      it("warns when the Antigravity hooks doc is not on disk", () => {
        const run = probe({ agyDoc: false });
        assert.equal(run.status, 0, run.stderr);
        assert.match(
          run.stdout,
          /WARNING: <SCRATCH>\/home\/\.gemini\/antigravity-cli\/.*hooks\.md not found/,
        );
        assert.match(run.stdout, /falling back to spec 0179's Notes record/);
        assert.doesNotMatch(run.stdout, /R10 time-unit check/);
        assertClean(run);
      });
    });

    describe("a CLI is missing", () => {
      const NAMES = ["claude", "gemini", "agy", "copilot"] as const;
      for (const name of NAMES) {
        it(`exits 1 naming '${name}' and runs no arm`, () => {
          const run = probe({ missing: [name] });
          assert.equal(run.status, 1);
          assert.equal(run.stderr, `ERROR: '${name}' not found in PATH.\n`);
          assert.doesNotMatch(run.stdout, /--- Claude Code ---/);
          assert.match(
            run.stdout,
            /Extension hook probe \(spec 0179 issue #1005, plan steps 1-2\)/,
          );
          assert.equal(run.calls, "", "no CLI is invoked once a precondition fails");
          assertClean(run, [AGY_DOC]);
        });
      }

      it("lists every missing binary, in claude, gemini, agy, copilot order", () => {
        const run = probe({ missing: NAMES });
        assert.equal(run.status, 1);
        assert.equal(run.stderr, NAMES.map((n) => `ERROR: '${n}' not found in PATH.\n`).join(""));
      });
    });
  });

describe("probe-extension-hooks: both legs agree", { skip: hostLacksProbeTools() }, () => {
  const cases: readonly [string, Options][] = [
    ["B1A root", { copilot: "root" }],
    ["B1A subdir", { copilot: "subdir" }],
    ["B2", { copilot: "none" }],
    ["B3", { copilot: "fail" }],
    ["no claude evidence", { claudeEvidence: false }],
    ["no agy doc", { agyDoc: false }],
    ["claude missing", { missing: ["claude"] }],
    ["all missing", { missing: ["claude", "gemini", "agy", "copilot"] }],
  ];
  for (const [name, o] of cases) {
    it(`same status, streams, files, calls and leftovers: ${name}`, () => {
      const sh = probeOn("shell", o);
      const ts = probeOn("entry", o);
      assert.equal(ts.status, sh.status);
      assert.equal(withoutR10(ts.stdout), withoutR10(sh.stdout));
      assert.equal(ts.stderr, sh.stderr);
      assert.deepEqual(ts.files, sh.files);
      assert.equal(ts.calls, sh.calls);
      assert.deepEqual(ts.tmpLeft, sh.tmpLeft);
    });
  }
});

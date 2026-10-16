// copilot.ts — the GitHub Copilot arm (the R12 branch point): one live tool-invoking session over
// two candidate hook placements, two follow-up probes, and the four-way verdict (B1A / B2 / B3).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { findOnPath } from "../../../tests/e2e/lib/exec.ts";
import { resolvedBinary, versionLine } from "./evidence.ts";
import { writeMatcherPlugin, writeProbePlugin, writeRootTokenPlugin } from "./plugins.ts";
import type { ProbeContext } from "./types.ts";
import { captureCopilotUsage } from "./usage-adapter.ts";

const TIMEOUT_RC = 124;

/** `date -u +%Y-%m-%dT%H:%M:%S.000Z`. */
function launchInstant(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z");
}

/** One bounded Copilot call; stdout and stderr go to `outFile` when given, else are discarded. */
function runCopilot(
  ctx: ProbeContext,
  bin: string,
  args: readonly string[],
  seconds: number,
  outFile: string | null,
): number {
  const exe = findOnPath(bin, ctx.env);
  if (exe === null) return 127;
  const fd = outFile === null ? null : fs.openSync(outFile, "w");
  try {
    const res = spawnSync(exe, [...args], {
      cwd: ctx.cwd,
      env: { ...ctx.env },
      stdio: ["inherit", fd ?? "ignore", fd ?? "ignore"],
      timeout: seconds * 1000,
      killSignal: "SIGTERM",
    });
    if (res.error !== undefined && res.status === null && res.signal === null) {
      return (res.error as NodeJS.ErrnoException).code === "ETIMEDOUT" ? TIMEOUT_RC : 127;
    }
    if (res.status !== null) return res.status;
    return res.signal === "SIGTERM" ? TIMEOUT_RC : 128;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

function logText(log: string, fallback: string): string {
  try {
    return fs.readFileSync(log, "utf8").replace(/\n+$/, "");
  } catch {
    return fallback;
  }
}

function followUp(
  ctx: ProbeContext,
  bin: string,
  seconds: number,
  work: string,
  pluginDir: string,
  prompt: string,
  usageName: string,
): void {
  const usageFile = path.join(work, usageName);
  const instant = launchInstant();
  const args = [
    "--plugin-dir",
    pluginDir,
    "-p",
    prompt,
    "--allow-all-tools",
    "--add-dir",
    work,
    "--usage-output-file",
    usageFile,
  ];
  runCopilot(ctx, bin, args, seconds, null);
  captureCopilotUsage(usageFile, instant, ctx.env, ctx.cwd);
}

export function copilotArm(ctx: ProbeContext, bin: string, seconds: number, work: string): void {
  const { out } = ctx;
  out("--- GitHub Copilot CLI (R12 branch point) ---\n");
  out(`  Version (self-reported): ${versionLine(bin, ctx)}\n`);
  out(`  Resolved binary path:    ${resolvedBinary(bin, ctx.env)}\n`);
  out("  (The spec's own Notes record self-reported 1.0.80 against a\n");
  out("   resolved binary of 1.0.49 — both readings are carried, per step 1.)\n");
  out("\n");

  const log = path.join(work, "hook-fired.log");
  const rootDir = path.join(work, "plugin-root-hooks");
  const subdirDir = path.join(work, "plugin-subdir-hooks");
  writeProbePlugin(rootDir, "crewrig-probe-root", "hooks.json", "MARKER_ROOT", log);
  writeProbePlugin(subdirDir, "crewrig-probe-subdir", "hooks/hooks.json", "MARKER_SUBDIR", log);

  out("  Installing a synthetic plugin at two candidate placements via\n");
  out("  --plugin-dir (root hooks.json, and hooks/hooks.json), envelope\n");
  out("  shape identical to the already-grounded user-level manifest\n");
  out("  (hooks/copilot-transcript-hooks.json), and running ONE live\n");
  out(`  tool-invoking session (bound: ${seconds}s)...\n`);
  out("\n");

  fs.writeFileSync(log, "");
  const copilotOut = path.join(work, "copilot-out.txt");
  const usage1 = path.join(work, "copilot-usage-1.json");
  const instant1 = launchInstant();
  const rc = runCopilot(
    ctx,
    bin,
    [
      "--plugin-dir",
      rootDir,
      "--plugin-dir",
      subdirDir,
      "-p",
      "Run the shell command: echo hello-world-probe",
      "--allow-all-tools",
      "--add-dir",
      work,
      "--usage-output-file",
      usage1,
    ],
    seconds,
    copilotOut,
  );
  captureCopilotUsage(usage1, instant1, ctx.env, ctx.cwd);

  out(`  copilot exit status: ${rc}\n`);
  const fired = (marker: string): boolean => {
    try {
      return fs.readFileSync(log, "utf8").includes(marker);
    } catch {
      return false;
    }
  };
  const rootFired = fired("MARKER_ROOT");
  const subdirFired = fired("MARKER_SUBDIR");
  out(`  hooks.json at plugin root fired:  ${rootFired ? "yes" : "no"}\n`);
  out(`  hooks/hooks.json (subdir) fired:  ${subdirFired ? "yes" : "no"}\n`);
  out("\n");

  if (rootFired || subdirFired) {
    out("  R11 root-token check: probing $COPILOT_PLUGIN_ROOT and $PWD...\n");
    fs.writeFileSync(log, "");
    const tokenDir = path.join(work, "plugin-root-token");
    writeRootTokenPlugin(tokenDir, log);
    const p2 = "Run the shell command: echo hello-world-probe-2";
    followUp(ctx, bin, seconds, work, tokenDir, p2, "copilot-usage-2.json");
    out(`  ${logText(log, "(no output captured)")}\n`);
    out("\n");

    out("  Matcher form check: does a non-matching regex suppress the hook,\n");
    out("  and a shell-tool regex match it? (confirms 'regex over tool\n");
    out("  names', shell tool identifier 'bash')...\n");
    fs.writeFileSync(log, "");
    const matcherDir = path.join(work, "plugin-matcher");
    writeMatcherPlugin(matcherDir, log);
    const p3 = "Run the shell command: echo hello-world-probe-3";
    followUp(ctx, bin, seconds, work, matcherDir, p3, "copilot-usage-3.json");
    out(`  ${logText(log, "(no output captured — re-run)")}\n`);
    out("\n");
  }

  verdict(ctx, rootFired || subdirFired, rc, copilotOut);
}

function verdict(ctx: ProbeContext, fired: boolean, rc: number, copilotOut: string): void {
  const { out } = ctx;
  const rule = "==========================================================\n";
  out(rule);
  out("  Verdict (step 2's four-way branch)\n");
  out(rule);
  if (fired) {
    out("  B1A — a Copilot plugin-level hook surface EXISTS and preToolUse is\n");
    out("  observed to fire, which is in the grounded three-way intersection\n");
    out("  (Claude PreToolUse / Gemini BeforeTool / Antigravity PreToolUse).\n");
    out("  -> Proceed with the full plan; write the Copilot column.\n");
  } else if (rc !== 0) {
    out(`  B3 — INCONCLUSIVE: the probe call itself failed (rc=${rc}).\n`);
    out("  Re-run before recording anything as an absence.\n");
    try {
      ctx.err(fs.readFileSync(copilotOut, "utf8"));
    } catch {
      // the shell's `cat` of a missing file prints its own error; the file always exists here
    }
  } else {
    out("  B2 — absence demonstrated: neither candidate placement fired for\n");
    out("  a well-formed hook using the already-grounded user-level schema.\n");
    out("  Escalate per the plan's Risk R1.\n");
  }
  out("\n");
  out("Record the outcome in docs/runbooks/extension-hook-probe.md, stamped\n");
  out("with each CLI's version and the date.\n");
}

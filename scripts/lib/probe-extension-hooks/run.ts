// run.ts — the extension-hook probe (twin of scripts/probe-extension-hooks.sh): preconditions, the
// four arms in order, and scratch cleanup in a finally. Returns the exit status.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { findOnPath } from "../../../tests/e2e/lib/exec.ts";
import { copilotArm } from "./copilot.ts";
import { agyArm, claudeArm, geminiArm } from "./evidence.ts";
import type { ProbeContext } from "./types.ts";

export const EXIT_OK = 0;
export const EXIT_PRECONDITION = 1;

export function runProbe(ctx: ProbeContext): number {
  const copilotBin = ctx.env["COPILOT_BIN"] || "copilot";
  const claudeBin = ctx.env["CLAUDE_BIN"] || "claude";
  const rawTimeout = ctx.env["PROBE_COPILOT_TIMEOUT"] || "120";
  const seconds = Number.parseInt(rawTimeout, 10);
  const { out } = ctx;
  const rule = "==========================================================\n";

  out(rule);
  out("  Extension hook probe (spec 0179 issue #1005, plan steps 1-2)\n");
  out(rule);
  out("\n");

  let missing = false;
  for (const bin of [claudeBin, "gemini", "agy", copilotBin]) {
    if (findOnPath(bin, ctx.env) === null) {
      ctx.err(`ERROR: '${bin}' not found in PATH.\n`);
      missing = true;
    }
  }
  if (missing) return EXIT_PRECONDITION;

  claudeArm(ctx, claudeBin);
  geminiArm(ctx);
  agyArm(ctx);

  const work = fs.mkdtempSync(path.join(ctx.env["TMPDIR"] || (process.platform === "win32" ? os.tmpdir() : "/tmp"), "tmp."));
  try {
    copilotArm(ctx, copilotBin, Number.isFinite(seconds) ? seconds : 120, work);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  return EXIT_OK;
}

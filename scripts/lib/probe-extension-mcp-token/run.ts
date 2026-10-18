// run.ts — the probe's control flow: select the questions, run them, and always clean up (the shell's
// EXIT trap) before reporting the exit status 0 / 1 / 2.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { cleanupAgy, probeQ2Q3Antigravity, type AgyState } from "./q2q3-antigravity.ts";
import { probeQ1Copilot } from "./q1-copilot.ts";
import { probeQ4Claude, probeQ4Copilot } from "./q4-collision.ts";
import { Abort, line, type Ctx, type Env } from "./io.ts";

export const EXIT_OK = 0;
export const EXIT_PRECONDITION = 1;
export const EXIT_INCONCLUSIVE = 2;

export interface ProbeIo {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}

export interface RunParams {
  readonly args: readonly string[];
  readonly env: Env;
  readonly cwd: string;
  readonly io: ProbeIo;
  /** `$0` of the shell: shown in the usage line. */
  readonly argv0: string;
}

/** Returns the exit status; the scratch directory and the Antigravity install never outlive the call. */
export function runProbe(p: RunParams): number {
  const what = p.args[0] ?? "all";
  const tmp = p.env["TMPDIR"] || (process.platform === "win32" ? os.tmpdir() : "/tmp");
  const work = fs.mkdtempSync(path.join(tmp, "tmp."));
  const ctx: Ctx = {
    env: p.env,
    cwd: p.cwd,
    out: p.io.out,
    err: p.io.err,
    work,
    failed: false,
    seq: 0,
  };
  const agy: AgyState = { installRoot: null };
  try {
    switch (what) {
      case "q1":
        probeQ1Copilot(ctx);
        break;
      case "q2q3":
        probeQ2Q3Antigravity(ctx, agy);
        break;
      case "q4":
        probeQ4Claude(ctx);
        probeQ4Copilot(ctx);
        break;
      case "all":
        probeQ1Copilot(ctx);
        probeQ2Q3Antigravity(ctx, agy);
        probeQ4Claude(ctx);
        probeQ4Copilot(ctx);
        break;
      default:
        ctx.err(`Usage: ${p.argv0} [q1|q2q3|q4|all]\n`);
        return EXIT_PRECONDITION;
    }
    line(ctx);
    line(ctx, "Record the verdicts above in docs/runbooks/extension-mcp-token-probe.md,");
    line(ctx, "stamped with each CLI's version and the date.");
    return ctx.failed ? EXIT_INCONCLUSIVE : EXIT_OK;
  } catch (error) {
    if (error instanceof Abort) return error.status;
    throw error;
  } finally {
    cleanupAgy(ctx, agy);
    fs.rmSync(work, { recursive: true, force: true });
  }
}

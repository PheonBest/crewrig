// usage-adapter.ts — the single seam to the headless usage capture (spec 0206): thin wrappers that
// pin the call shape, so a signature change in ../usage-headless.ts touches this file only.

import {
  usageHeadlessAgyRewriteJsonResponse,
  usageHeadlessCaptureUsageFile,
} from "../usage-headless.ts";
import type { Env } from "./io.ts";

/** Derive one run-total record from Copilot's `--usage-output-file` after the wrapped call. */
export function captureUsageFile(
  cli: string,
  usageFile: string,
  launchInstant: string,
  env: Env,
  cwd: string,
): void {
  usageHeadlessCaptureUsageFile(cli, usageFile, launchInstant, env, { cwd });
}

/** Derive a record from agy's JSON envelope in `outFile` and rewrite it to its `.response` field. */
export function agyRewriteJsonResponse(
  outFile: string,
  launchInstant: string,
  env: Env,
  cwd: string,
): void {
  usageHeadlessAgyRewriteJsonResponse(outFile, launchInstant, env, { cwd });
}

// usage-adapter.ts — the single seam from the probe to scripts/lib/usage-headless.ts.

import { usageHeadlessCaptureUsageFile } from "../usage-headless.ts";
import type { Env } from "./types.ts";

/** usage_headless_capture_usage_file copilot-cli <file> <instant>, after a wrapped Copilot call. */
export function captureCopilotUsage(
  usageFile: string,
  launchInstant: string,
  env: Env,
  cwd: string,
): void {
  usageHeadlessCaptureUsageFile("copilot-cli", usageFile, launchInstant, env, { cwd });
}

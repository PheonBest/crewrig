// usage-adapter.ts — the single seam to the usage-capture helper (spec 0206): the probe hands the
// `agy ... --output-format json` envelope file to `usage-headless.ts`, which records one run-total
// usage record and rewrites the file in place to the envelope's own `.response` string.

import { usageHeadlessAgyRewriteJsonResponse } from "../usage-headless.ts";

export function rewriteResponse(
  outFile: string,
  launchInstant: string,
  env: Readonly<Record<string, string>>,
): void {
  usageHeadlessAgyRewriteJsonResponse(outFile, launchInstant, env);
}

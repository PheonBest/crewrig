// e2e-normalise.ts — placeholders for the end-to-end harness oracle (spec 0261 R5, R7, R8).
//
// Rules, applied in this order (longest first, so a path is named before the directory it sits in):
//   1. node executable path (ctx.node, default process.execPath) -> <NODE>
//   2. scratch dirs ctx.tmp and its realpath               -> <TMP>
//   3. ctx.e2eHome                                           -> <E2E_HOME>
//   4. ctx.home                                              -> <HOME>
//   5. container names built from a run id (`crewrig-e2e-...`) -> <CONTAINER>
//   6. run ids `YYYYMMDDTHHMMSSZ-xxxx`                       -> <RUN_ID>
//   7. ISO timestamps `YYYY-MM-DDTHH:MM:SS[.fff]Z`           -> <TS>
//   8. ports in `:NNNN` / `:NNNNN` URLs                      -> <PORT>
//   9. `mktemp` suffixes of `crewrig-e2e-*.XXXXXX` dirs        -> .<RAND>
//  10. probe nonces `crewrig-probe-<x>-<word>-<16 hex>`        -> <NONCE>

import fs from "node:fs";

export interface NormaliseContext {
  readonly tmp: string;
  readonly home: string;
  readonly e2eHome: string;
  readonly node?: string;
}

const RUN_ID = /\d{8}T\d{6}Z-[0-9a-f]{4}/g;
const CONTAINER = /crewrig-e2e-[A-Za-z0-9_.-]*?\d{8}T\d{6}Z-[0-9a-f]{4}[A-Za-z0-9_.-]*/g;
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;
const MKTEMP = /(crewrig-e2e-[A-Za-z0-9-]+)\.[A-Za-z0-9]{6}\b/g;
const NONCE = /(crewrig-probe-[a-z]-[a-z]+-)[0-9a-f]{16}\b/g;
const PORT = /(:\/\/[^\s/:]+):\d{4,5}\b/g;

function real(dir: string): string {
  try {
    return fs.realpathSync(dir);
  } catch {
    return dir;
  }
}

export function normalise(text: string, ctx: NormaliseContext): string {
  const named: Array<[string, string]> = [
    [ctx.node ?? process.execPath, "<NODE>"],
    [ctx.tmp, "<TMP>"],
    [real(ctx.tmp), "<TMP>"],
    [ctx.e2eHome, "<E2E_HOME>"],
    [ctx.home, "<HOME>"],
  ];
  named.sort((a, b) => b[0].length - a[0].length);
  let out = text;
  for (const [value, token] of named) if (value !== "") out = out.split(value).join(token);
  return out
    .replace(CONTAINER, "<CONTAINER>")
    .replace(RUN_ID, "<RUN_ID>")
    .replace(ISO, "<TS>")
    .replace(PORT, "$1:<PORT>")
    .replace(MKTEMP, "$1.<RAND>")
    .replace(NONCE, "$1<NONCE>");
}

export function normaliseArgv(argv: readonly string[], ctx: NormaliseContext): string[] {
  return argv.map((arg) => normalise(arg, ctx));
}

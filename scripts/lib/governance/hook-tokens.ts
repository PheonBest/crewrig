// hook-tokens.ts — the R12 token check (spec 0179) in TypeScript (spec 0259): no emitted hook
// file may still carry the neutral token `${extensionRoot}`.
//
// Usage: const code = await checkHookTokens({ repoDir, io, env, platform, entryFile });
// Reuses scripts/lib/extension/{resolve,render-extension,entry-ctx,check-arms}.ts: the render is
// the in-process twin of `build-extension --target all <dir>` with its output discarded.
// Exit codes: returns 0 when no emitted file carries the token, 1 otherwise.
// Finding-line format: `  FAIL <path> — surviving neutral token occurrence <i>/<N> ('${extensionRoot}')`
// repeated once per occurrence, then a blank line and the FAILED summary.

import fs from "node:fs";

import { cleanupStrayPluginDist } from "../extension/check-arms.ts";
import { createCtx } from "../extension/entry-ctx.ts";
import type { EntryInput } from "../extension/entry-ctx.ts";
import { renderExtension } from "../extension/render-extension.ts";
import { discoverDirs } from "../extension/resolve.ts";
import { TARGETS } from "../extension/types.ts";

const NEUTRAL_TOKEN = "${extensionRoot}";

/** The manifest name as `jq -r '.name'` prints it, or null when the shell would skip it. */
function manifestName(extDir: string): string | null {
  let value: unknown;
  try {
    value = (JSON.parse(fs.readFileSync(`${extDir}/extension.json`, "utf8")) as { name?: unknown })
      .name;
  } catch {
    return null;
  }
  if (typeof value === "string") return value === "" ? null : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

/** Print one FAIL line per occurrence; returns 1 when the file carries the token, else 0. */
function checkFile(file: string, out: (line: string) => void): number {
  let text: string;
  try {
    if (!fs.statSync(file).isFile()) return 0;
    text = fs.readFileSync(file, "latin1");
  } catch {
    return 0;
  }
  const occurrences = text.split(NEUTRAL_TOKEN).length - 1;
  for (let i = 1; i <= occurrences; i += 1) {
    out(
      `  FAIL ${file} — surviving neutral token occurrence ${i}/${occurrences} ('${NEUTRAL_TOKEN}')`,
    );
  }
  return occurrences > 0 ? 1 : 0;
}

export async function checkHookTokens(input: EntryInput): Promise<number> {
  const { out } = input.io;
  const quiet = { out: () => {}, err: () => {}, errRaw: () => {} };
  const ctx = await createCtx({ ...input, io: quiet });
  if (ctx === null) return 1;
  let failures = 0;
  for (const extDir of discoverDirs(ctx.repoDir)) {
    const name = manifestName(extDir);
    if (name === null) continue;
    try {
      await renderExtension(ctx, extDir, TARGETS);
    } catch {
      // The shell discards the build's output and status alike.
    }
    failures += checkFile(`${ctx.repoDir}/build/extensions/${name}/hooks/hooks.json`, out);
    failures += checkFile(`${extDir}/dist-claude-plugin/${name}/hooks/hooks.json`, out);
    failures += checkFile(`${ctx.repoDir}/dist-copilot-plugin/${name}/hooks.json`, out);
    failures += checkFile(`${ctx.repoDir}/dist-antigravity-plugin/${name}/hooks.json`, out);
  }
  cleanupStrayPluginDist(ctx.repoDir);
  if (failures > 0) {
    out("");
    out(`FAILED: ${failures} emitted hook file(s) still carry the neutral extension-root token.`);
    return 1;
  }
  out("OK: no emitted hook file carries an unresolved neutral extension-root token.");
  return 0;
}

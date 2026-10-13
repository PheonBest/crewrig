// prepare-cmd.ts — the command strings of the engine's `@semantic-release/exec`
// plugin (spec 0257 R16, Decision D2). The engine runs them through `sh -c` on
// POSIX and `cmd.exe` on Windows, so they use bare `node`, double quotes and
// `&&` only: the one grammar both accept. No `bash`, no `jq`.

import { ReleaseRefusal } from "./refusal.ts";

export interface PrepareCmdOptions {
  root: string;
  ext: string;
  out: string;
  /** Passed through untouched: the engine template or a validated literal. */
  version: string;
  platform?: NodeJS.Platform;
}

export interface SyncCmdOptions {
  root: string;
  version: string;
  platform?: NodeJS.Platform;
}

// Each of these is live inside a double-quoted word of `sh` or `cmd.exe`
// (expansion, command substitution, variable expansion, escape, line break).
const FORBIDDEN = /["%!$`\\\r\n]/;

/**
 * Validate and normalise a path destined for a double-quoted command word.
 * On Windows the separators become `/`, which `node` and `cmd.exe` both accept,
 * so a native drive path is not refused; elsewhere a backslash is a character
 * of the name and is refused like the other shell-active characters.
 */
function quotedPath(value: string, platform: NodeJS.Platform): string {
  const normalised = platform === "win32" ? value.replaceAll("\\", "/") : value;
  if (normalised.startsWith("//") || value.startsWith("\\\\")) {
    throw new ReleaseRefusal(`a UNC path cannot be used in the release commands: ${value}`);
  }
  if (FORBIDDEN.test(normalised)) {
    throw new ReleaseRefusal(
      `a path holding a double quote, percent sign, exclamation mark, dollar sign, backtick, backslash or line break cannot be used in the release commands: ${value}`,
    );
  }
  return normalised;
}

/** The manifest-lockstep half: syncs `package.json` and `extension.json` (spec 0044). */
export function syncCmd(opts: SyncCmdOptions): string {
  const root = quotedPath(opts.root, opts.platform ?? process.platform);
  return `node "${root}/scripts/release-sync-manifests.ts" ${opts.version}`;
}

/** Sync, then package the installable tree: the one place its shape is decided. */
export function prepareCmd(opts: PrepareCmdOptions): string {
  const platform = opts.platform ?? process.platform;
  const out = quotedPath(opts.out, platform);
  return `${syncCmd(opts)} && node "${quotedPath(opts.root, platform)}/scripts/release-package-extension.ts" ${opts.ext} --version ${opts.version} --out "${out}"`;
}

// evidence.ts — the Claude Code, Gemini CLI and Antigravity arms of the extension-hook probe, and
// the small helpers every arm shares (version line, resolved binary, embedded-doc byte scan).

import fs from "node:fs";
import path from "node:path";

import { findOnPath, runTool } from "../../../tests/e2e/lib/exec.ts";
import type { Env, ProbeContext } from "./types.ts";

/** `<bin> --version 2>&1 | head -1`: the first line of stdout then stderr, no trailing newline. */
export function versionLine(bin: string, ctx: ProbeContext): string {
  const res = runTool(bin, ["--version"], { cwd: ctx.cwd, env: ctx.env });
  return (res.stdout + res.stderr).split("\n")[0] ?? "";
}

/** `readlink -f "$(command -v bin)" || command -v bin`. */
export function resolvedBinary(bin: string, env: Env): string {
  const found = findOnPath(bin, env) ?? "";
  try {
    return fs.realpathSync(found);
  } catch {
    return found;
  }
}

/**
 * `strings -a <file> | grep -q <needle>` as a byte scan: every needle used here is printable, so a
 * match in the raw bytes lies inside one printable run of at least four characters.
 */
export function embeddedStringPresent(file: string, needle: string): boolean {
  try {
    return fs.readFileSync(file).includes(Buffer.from(needle, "latin1"));
  } catch {
    return false;
  }
}

export function claudeArm(ctx: ProbeContext, claudeBin: string): void {
  const { out } = ctx;
  out("--- Claude Code ---\n");
  const version = versionLine(claudeBin, ctx);
  const resolved = resolvedBinary(claudeBin, ctx.env);
  out(`  Version (self-reported): ${version}\n`);
  out(`  Resolved binary: ${resolved}\n`);
  if (embeddedStringPresent(resolved, '"hooks": {')) {
    out("  R9 envelope check: installed binary's own embedded doc shows\n");
    out("    an ENVELOPE ('\"hooks\": {') — build-claude-plugin.sh's incumbent\n");
    out('    {"hooks": ...} wrapper is confirmed, not merely inherited.\n');
  } else {
    out("  R9 envelope check: no '\"hooks\": {' envelope string found in the\n");
    out("    installed binary — INCONCLUSIVE, do not assume either shape.\n");
  }
  if (embeddedStringPresent(resolved, "CLAUDE_PLUGIN_ROOT")) {
    out("  R11 root-token check: CLAUDE_PLUGIN_ROOT confirmed present in the\n");
    out("    installed binary.\n");
  }
  out("\n");
}

export function geminiArm(ctx: ProbeContext): void {
  const { out } = ctx;
  out("--- Gemini CLI ---\n");
  out(`  Version (self-reported): ${versionLine("gemini", ctx)}\n`);
  out("  Evidence: already grounded by spec 0179's own probe record (Notes ->\n");
  out("  Probe record), method 'documentation shipped in the installed\n");
  out("  bundle, plus the bundle's own extension-hook loader'. Re-derivable\n");
  out("  only by re-running that authoring-time probe against the bundle in\n");
  out("  $(command -v gemini)'s install tree, not by a byte grep of the\n");
  out("  minified bundle (attempted; no plain-text event tokens survive\n");
  out("  minification).\n");
  out("\n");
}

export function agyArm(ctx: ProbeContext): void {
  const { out } = ctx;
  out("--- Antigravity CLI ---\n");
  out(`  Version (self-reported): ${versionLine("agy", ctx)}\n`);
  const doc = path.join(
    ctx.env["HOME"] ?? "",
    ".gemini/antigravity-cli/builtin/skills/agy-customizations/docs/hooks.md",
  );
  let text: string | null = null;
  try {
    if (fs.statSync(doc).isFile()) text = fs.readFileSync(doc, "latin1");
  } catch {
    text = null;
  }
  if (text !== null) {
    out(`  Evidence: ${doc} (vendor hook and plugin contract shipped\n`);
    out("    on disk with the CLI).\n");
    if (text.includes("The working directory is set to the directory containing")) {
      out("  R11 root-token check: confirmed — no path variable; working\n");
      out("    directory is the directory holding hooks.json.\n");
    }
    if (text.includes("Defaults to `30`")) {
      out("  R10 time-unit check: confirmed — seconds, default 30.\n");
    }
  } else {
    out(`  WARNING: ${doc} not found on this machine — cannot\n`);
    out("    re-confirm from disk; falling back to spec 0179's Notes record.\n");
  }
  out("\n");
}

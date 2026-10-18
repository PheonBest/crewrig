// chroma-unit.ts — the unit materialisation of `install_chroma_daemon` (`_materialise_chroma_unit`,
// `install_tls_exec_wrapper` of retired scripts/lib/common.sh; spec 0256 requirement 25, delta-01 deviation
// (q); spec 0266 slice 5b). It renders the shipped launchd plist or systemd unit with the interpreter,
// the chroma binary and the palace path, refuses a rendering that keeps a `__X__` placeholder, and
// installs the Node.js trust wrapper to `~/.crewrig/tls-exec.ts` (the program and bundle of spec 0252
// requirement 12, `installTrustWrapperProgram`). The supervisor runs it with the running Node.js
// executable, as `service/unit-render.ts` does for the MCP daemon. A unit written by an earlier setup
// (`bash ~/.crewrig/tls-exec.sh`) is overwritten by the next run; its installed `.sh` copy is left
// where it is, so a daemon loaded from the old unit keeps running until it is reloaded. On win32 the
// daemon is a scheduled task, so only the chroma binary pre-flight runs (in its Windows form) and
// nothing is written.

import { accessSync, constants, existsSync, mkdirSync } from "node:fs";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { SetupCtx } from "./context.ts";
import { installTrustWrapperProgram, installedPaths } from "../service/program-install.ts";
import { chromaPalacePathFor, renderUnit } from "../service/unit-render.ts";

export interface ChromaUnitRequest {
  readonly ctx: Pick<SetupCtx, "io" | "env" | "platform" | "home" | "repoDir">;
  /** The shipped template (`config/launchd/*.plist` or `config/systemd/*.service`). */
  readonly template: string;
  /** Where the materialised unit is written. */
  readonly target: string;
  /** The mempalace interpreter, already resolved (`MEMPALACE_PYTHON`, else detection); empty when none. */
  readonly python: string | undefined;
}

export interface ChromaUnitResult {
  /** False when the shell's function would have returned non-zero; the messages are already printed. */
  readonly ok: boolean;
  /** The rendered text; undefined when nothing was written (a refusal, or win32). */
  readonly text?: string;
}

const FIX = "run: pipx inject mempalace 'chromadb>=1.5.9'";

/** `<python dir>/chroma` on POSIX, `<venv>\Scripts\chroma.exe` on win32 (the interpreter sits in `Scripts`). */
export function chromaBinaryFor(python: string, platform: NodeJS.Platform): string {
  if (platform === "win32") return path.win32.join(path.win32.dirname(python), "chroma.exe");
  return `${path.posix.dirname(python)}/chroma`;
}

/** The installed trust wrapper: `MEMPALACE_TLS_EXEC_PATH` (`.sh` read as `.ts`) else `<home>/.crewrig/tls-exec.ts`. */
export function tlsExecInstalledPath(ctx: Pick<SetupCtx, "env" | "home">): string {
  return installedPaths(ctx.home, ctx.env).wrapper;
}

function isExecutable(file: string): boolean {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Install the wrapper program and its bundle; false (after the message) when it is not shipped. */
export function installTlsExecWrapper(ctx: ChromaUnitRequest["ctx"]): boolean {
  const src = path.join(ctx.repoDir, "scripts", "tls-exec.ts");
  if (!existsSync(src)) {
    ctx.io.out(`  ERROR: ${src} missing — tls-exec wrapper not shipped.`);
    return false;
  }
  installTrustWrapperProgram({ paths: installedPaths(ctx.home, ctx.env) });
  return true;
}

export function materialiseChromaUnit(req: ChromaUnitRequest): ChromaUnitResult {
  const { ctx, python } = req;
  if (python === undefined || python === "") {
    ctx.io.out("  ERROR: cannot detect mempalace pipx python — install mempalace first.");
    return { ok: false };
  }
  const chromaBin = chromaBinaryFor(python, ctx.platform);
  const mocked = ctx.env["CREWRIG_TEST_MOCK_CHROMA_BIN"] === "true";
  const present = ctx.platform === "win32" ? existsSync(chromaBin) : isExecutable(chromaBin);
  if (!present && !mocked) {
    ctx.io.out(`  ERROR: chroma binary not found at ${chromaBin} — ${FIX}`);
    return { ok: false };
  }
  if (ctx.platform === "win32") return { ok: true };

  const mempalaceHome = path.join(ctx.home, ".mempalace");
  let template: string;
  try {
    template = readFileSync(req.template, "utf8");
  } catch {
    ctx.io.out(`  ERROR: ${req.template} missing — daemon supervisor unit not shipped.`);
    return { ok: false };
  }
  const flavour = req.template.endsWith(".service") ? "service" : "plist";
  const palacePath = chromaPalacePathFor(flavour, ctx.home, ctx.env["MEMPALACE_PALACE_PATH"]);

  if (!installTlsExecWrapper(ctx)) return { ok: false };

  const rendered = renderUnit({
    templatePath: req.template,
    template,
    targetPath: req.target,
    nodePath: process.execPath,
    values: {
      mempalaceHome,
      pipxPython: python,
      chromaBin,
      chromaPalacePath: palacePath,
      tlsExec: tlsExecInstalledPath(ctx),
    },
  });
  if (!rendered.ok) {
    // The shell wrote the file, found the placeholder, then removed it.
    rmSync(req.target, { force: true });
    ctx.io.err(`  ERROR: ${rendered.reason}`);
    return { ok: false };
  }
  const text = rendered.text;
  mkdirSync(path.dirname(req.target), { recursive: true });
  writeFileSync(req.target, text, { mode: 0o644 });
  return { ok: true, text };
}

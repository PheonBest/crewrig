// scratch.ts — the driver's scratch directory and the cleanup it owes on exit or on a signal
// (spec 0257 R18, R19), plus the ledger of what a publish run created under `dist/`.
//
// Library code never calls `process.exit`: a signal handler stops the children, removes the
// scratch directory and records the conventional exit code, and the event loop then drains
// because nothing is left running. A caller that must act at once injects `exit`.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { killAll } from "./spawn.ts";

export interface Scratch {
  readonly dir: string;
  /** Idempotent and synchronous, so it is safe inside an `exit` handler. */
  dispose(): void;
}

export interface CleanupHooks {
  /** Called after the children were stopped and the scratch directory removed. */
  readonly onSignal?: () => void;
  /** Called with the conventional exit code (130, 143); the default leaves `process.exitCode` only. */
  readonly exit?: (code: number) => void;
}

export function createScratch(opts: { parent?: string } = {}): Scratch {
  const dir = fs.mkdtempSync(path.join(opts.parent ?? os.tmpdir(), "crewrig-release-"));
  return {
    dir,
    dispose(): void {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * Remove the scratch directory on `exit`, and on SIGINT or SIGTERM stop every child first.
 * Returns the function that uninstalls the handlers.
 */
export function installCleanup(scratch: Scratch, hooks: CleanupHooks = {}): () => void {
  const onExit = (): void => scratch.dispose();
  const signalHandler = (signal: NodeJS.Signals, code: number) => (): void => {
    killAll(signal);
    scratch.dispose();
    process.exitCode = code;
    hooks.onSignal?.();
    hooks.exit?.(code);
  };
  const onInt = signalHandler("SIGINT", 130);
  const onTerm = signalHandler("SIGTERM", 143);
  process.once("exit", onExit);
  process.once("SIGINT", onInt);
  process.once("SIGTERM", onTerm);
  return () => {
    process.removeListener("exit", onExit);
    process.removeListener("SIGINT", onInt);
    process.removeListener("SIGTERM", onTerm);
  };
}

/**
 * What `release_publish` leaves behind and removes at its end: the whole `dist/` when the run
 * created it, otherwise only this run's `dist/release/<ext>` directories and noted files, then
 * `dist/release` itself when that left it empty.
 */
export class DistLedger {
  #distDir = "";
  #preexisted = false;
  readonly #created: string[] = [];

  begin(distDir: string): void {
    this.#distDir = distDir;
    this.#preexisted = fs.existsSync(distDir);
  }

  noteCreated(created: string): void {
    this.#created.push(created);
  }

  cleanup(extNames: readonly string[]): void {
    if (this.#distDir === "") return;
    if (!this.#preexisted) {
      fs.rmSync(this.#distDir, { recursive: true, force: true });
      return;
    }
    const release = path.join(this.#distDir, "release");
    for (const name of extNames)
      fs.rmSync(path.join(release, name), { recursive: true, force: true });
    for (const created of this.#created) fs.rmSync(created, { recursive: true, force: true });
    try {
      fs.rmdirSync(release);
    } catch {
      // Absent, or still holding something that is not ours.
    }
  }
}

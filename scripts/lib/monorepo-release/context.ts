// context.ts — the state every flow of the release driver shares (spec 0257 requirement 14): the
// preflight results, the output channels and the error counter the shell kept in globals.

import type { Scratch } from "./scratch.ts";

export interface ReleaseCtx {
  readonly forge: "github" | "gitlab";
  readonly mode: "publish" | "rehearsal";
  readonly branch: string;
  /** The checkout the driver runs in (the shell's ROOT_DIR, the working directory). */
  readonly rootDir: string;
  /** The `scripts/` directory of the checkout that holds this driver (the shell's SCRIPT_DIR). */
  readonly scriptsDir: string;
  /** The environment the children inherit: the identity defaults and the credential applied, NODE_PATH set. */
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly platform: NodeJS.Platform;
  /** One line on standard output. */
  readonly out: (line: string) => void;
  /** One line on standard error. */
  readonly err: (line: string) => void;
  /** A raw chunk on standard output (the teed engine output). */
  readonly outRaw: (chunk: string) => void;
  /** A raw chunk on standard error. */
  readonly errRaw: (chunk: string) => void;
  readonly scratch: Scratch;
  /** The shell's ERRORS flag: set to 1 by any flow that reports a failure. */
  errors: number;
  /** True once a termination signal has been received: a flow's extension loop stops. */
  aborted: () => boolean;
}

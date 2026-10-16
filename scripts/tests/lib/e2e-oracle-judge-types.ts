// e2e-oracle-judge-types.ts — shape of a judge case (spec 0261 R9, PLAN v3 PR 2 step 2).
// Placeholders in strings: {BASE} stand-in URL, {HOME} scratch home, {REPORT} report dir,
// {ED25519_KEY} a freshly generated Ed25519 private key (PEM), {FAR_FUTURE_MS} far-future expiry.

import type { CannedReply, EndpointKey, RecordedRequest } from "./e2e-judge-endpoints.ts";

export interface JudgeSeedFile {
  /** Relative to the scratch HOME. */
  readonly path: string;
  readonly content: string;
  readonly mode: number;
}

export interface JudgeExpect {
  readonly rc: number;
  /** Exact stdout line, or "" when the judge prints nothing. */
  readonly stdout: string;
  readonly stderrIncludes?: readonly string[];
  /** Number of requests the stand-in must have received. */
  readonly requests: number;
  /** Final contents of judge.count; omitted = file must not exist or be unchecked. */
  readonly count?: string;
}

export interface JudgeCase {
  readonly id: string;
  readonly backend: string;
  /** The `[judge]` object written to the scratch effective.json. */
  readonly effectiveJudge: Readonly<Record<string, unknown>>;
  readonly seed?: readonly JudgeSeedFile[];
  readonly env?: Readonly<Record<string, string>>;
  readonly strict?: boolean;
  /** Initial judge.count. */
  readonly preCount?: number;
  readonly responses: Readonly<Partial<Record<EndpointKey, readonly CannedReply[]>>>;
  readonly args: { readonly prompt: string; readonly answer: string; readonly criterion: string };
  readonly expect: JudgeExpect;
  /** Needs POSIX file modes (skipped on win32). */
  readonly posixOnly?: boolean;
  /** Signature bytes differ per run: the recorded request is structure only. */
  readonly nonDeterministicSignature?: boolean;
  /** Put an `openssl` shim on PATH that gives `pkeyutl -sign -rawin` a file instead of a pipe. */
  readonly opensslFileShim?: boolean;
}

export interface JudgeTuple {
  readonly id: string;
  readonly rc: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly requests: readonly RecordedRequest[];
  readonly files: Readonly<Record<string, string>>;
}

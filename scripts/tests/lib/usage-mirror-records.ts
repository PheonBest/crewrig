// usage-mirror-records.ts — the usage-record factory of the mirror suites (port of the
// Bash driver's `make-record`): a schema-conforming captured or uncaptured record.

import { createHash } from "node:crypto";

export interface RecordOpts {
  kind?: "captured" | "uncaptured";
  cli?: string;
  session: string;
  idemKey: string;
  instant: string;
}

export function makeRecord(o: RecordOpts): Record<string, unknown> {
  const kind = o.kind ?? "captured";
  const recordId = createHash("sha256").update(`${o.session}\x1F${o.idemKey}`).digest("hex");
  const record: Record<string, unknown> = {
    schemaVersion: "1.0.0",
    kind,
    fidelity: "per-request",
    recordId,
    idempotencyKey: o.idemKey,
    provenance: {
      cli: o.cli ?? "claude-code",
      cliVersion: "1.0.0",
      captureChannel: "test-fixture",
      formatFingerprint: `sha256:${"0".repeat(32)}`,
    },
    identity: {
      sessionId: o.session,
      parentSessionId: null,
      agentId: null,
      projectRoot: "/home/agent/workspaces/crewrig",
    },
    timing: { requestInstant: o.instant, captureInstant: o.instant },
  };
  if (kind === "captured") {
    record.modelId = "claude-sonnet-5";
    record.interaction = "user-turn";
    record.tokens = { netInput: 100, cacheRead: 0, cacheWrite: 0, output: 50, reasoning: 0 };
    record.raw = { vendor: "test-fixture", usage: { input_tokens: 100, output_tokens: 50 } };
    record.rawStatus = "complete";
  } else {
    record.uncapturedReason = "test-fixture uncaptured reason";
  }
  return record;
}

/** `n` record descriptions (the last `uncaptured` when asked): captured 1..n-1 then one uncaptured. */
export function seedOpts(
  prefix: string,
  cli: string,
  instant: string,
  n: number,
  lastUncaptured = false,
): RecordOpts[] {
  return Array.from({ length: n }, (_, i) => ({
    kind: lastUncaptured && i === n - 1 ? ("uncaptured" as const) : ("captured" as const),
    cli,
    session: `${prefix}-session-${i + 1}`,
    idemKey: `${prefix}-key-${i + 1}`,
    instant,
  }));
}

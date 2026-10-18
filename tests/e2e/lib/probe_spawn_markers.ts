// probe_spawn_markers.ts — twin of tests/e2e/lib/probe_spawn_markers.sh: CLI-generated spawn-result
// marker detection for probes A and B (spec 0194 R14; spec 0261 R1-R4). Pure over the file content.

import fs from "node:fs";
import path from "node:path";

const WS = /^[ \t\n\r\f\v]+/;
const NO_RESPONSE = "Agent completed but produced no response.";

/** ASCII-only lower-casing, as `tr '[:upper:]' '[:lower:]'` and jq `ascii_downcase`. */
function asciiLower(s: string): string {
  return s.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/** jq `//`: the first operand that is neither null nor false. */
function alt(...values: unknown[]): unknown {
  for (const v of values) if (v !== null && v !== undefined && v !== false) return v;
  return undefined;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function line(a: boolean, b: boolean, c: boolean, model: string): string {
  return `${a}|${b}|${c}|${model}\n`;
}

function fromStats(root: Record<string, unknown>, agentLc: string, raw: string, nonce: string) {
  const stats = root["subagent_stats"];
  const byType = isObject(stats) && isObject(stats["by_type"]) ? stats["by_type"] : {};
  const st = isObject(stats) ? stats : {};
  const failedAll = num(alt(st["failed"], st["total_errored"], 0));
  const completedAll = num(alt(st["completed"], st["total_completed"], 0));
  let spawned = 0;
  let completed = 0;
  let errored = 0;
  for (const [key, value] of Object.entries(byType)) {
    if (asciiLower(key) !== agentLc) continue;
    if (isObject(value)) {
      spawned += num(alt(value["spawned"], 0));
      completed += num(alt(value["completed"], 0));
      errored += num(alt(value["errored"], 0));
    } else {
      spawned += num(alt(value, 0));
      completed += completedAll > 0 && failedAll === 0 ? num(alt(value, 0)) : 0;
      errored += failedAll;
    }
  }
  const observed = spawned > 0;
  const responded = completed > 0 && errored === 0;
  const nonceIn = observed && responded && raw.includes(nonce);
  const usage = root["modelUsage"];
  const keys = isObject(usage) ? Object.keys(usage).sort() : [];
  return line(observed, responded, nonceIn, keys[0] ?? "claude");
}

/** `e2e_probe_spawn_signals <file> <agent> <nonce>`; `work` resolves a relative file. */
export function probeSpawnSignals(
  file: string,
  agent: string,
  nonce: string,
  work: string,
): string {
  let raw: string;
  try {
    raw = fs.readFileSync(path.resolve(work, file), "utf8");
  } catch {
    return "false|false|false|\n";
  }
  const agentLc = asciiLower(agent);

  try {
    const root: unknown = JSON.parse(raw);
    if (isObject(root) && alt(root["subagent_stats"]) !== undefined) {
      return fromStats(root, agentLc, raw, nonce);
    }
  } catch {
    // not a single JSON document: fall through to the transcript walk.
  }

  const normalized = raw.replaceAll("✗", "\n✗").replaceAll("●", "\n●");
  let spawnObserved = false;
  let responded = false;
  let nonceIn = false;
  let model = "";
  let expect = false;
  for (const l of normalized.split("\n")) {
    const trimmed = l.replace(WS, "");
    if (trimmed.startsWith("✗") || trimmed.startsWith("●")) {
      if (asciiLower(trimmed).includes(`${agentLc}(`)) {
        spawnObserved = true;
        expect = true;
        const after = trimmed.slice(trimmed.indexOf("(") + 1);
        const close = after.indexOf(")");
        model = close < 0 ? after : after.slice(0, close);
      } else {
        expect = false;
      }
    } else if (trimmed.includes("└")) {
      if (expect) {
        const result = trimmed.slice(trimmed.indexOf("└") + 1).replace(WS, "");
        if (
          result !== NO_RESPONSE &&
          result !== "idle" &&
          !result.startsWith("Agent started in background")
        ) {
          responded = true;
        }
        if (trimmed.includes(nonce)) nonceIn = true;
      }
      expect = false;
    } else {
      expect = false;
    }
  }
  return line(spawnObserved, responded, nonceIn, model);
}

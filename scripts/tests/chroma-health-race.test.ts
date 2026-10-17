// chroma-health-race.test.ts — regression for issue #138: the health check at
// the tail of `install_chroma_daemon` (scripts/lib/common.sh, marker
// `# Health check`) must poll instead of one-shotting. The block is extracted
// from the live common.sh and run in a bash harness against a slow-start stub
// (healthy after 2 s). Retires with scripts/lib/common.sh (row J4). POSIX-only:
// the subject is a Bash block. No daemon, port, service manager or HOME access.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { REPO } from "./lib/chroma-stand-in.ts";

const SKIP = process.platform === "win32" ? "the subject is a Bash block of common.sh" : false;

/** The lines from `  # Health check` to the closing `}` of the function. */
function extractBlock(): string {
  const out: string[] = [];
  let capture = false;
  for (const line of fs
    .readFileSync(path.join(REPO, "scripts/lib/common.sh"), "utf8")
    .split("\n")) {
    if (line.startsWith("  # Health check")) capture = true;
    if (capture && line === "}") break;
    if (capture) out.push(line);
  }
  return out.join("\n");
}

const STUB = `#!/usr/bin/env bash
set -u
marker_file="$(dirname "$0")/../started_at"
if [[ ! -f "$marker_file" ]]; then echo "stub: missing marker" >&2; exit 2; fi
elapsed=$(( $(date +%s) - $(cat "$marker_file") ))
if (( elapsed < 2 )); then echo "stub: not ready (elapsed=\${elapsed}s)" >&2; exit 1; fi
echo "stub: daemon healthy (elapsed=\${elapsed}s)"
`;

describe("chroma health-check block", { skip: SKIP }, () => {
  const sandbox = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "chroma-health-race-"));
  after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const block = extractBlock();

  test("the extraction finds the `# Health check` block (non-vacuity)", () => {
    assert.notEqual(block, "", "could not locate the '# Health check' marker in common.sh");
  });

  test("the block survives a 2 s slow start (race-tolerant)", () => {
    fs.mkdirSync(path.join(sandbox, "scripts"));
    fs.writeFileSync(path.join(sandbox, "started_at"), `${Math.floor(Date.now() / 1000)}\n`);
    fs.writeFileSync(path.join(sandbox, "scripts", "status-chroma-server.sh"), STUB, {
      mode: 0o755,
    });
    // Wrapped in a function so `return N` behaves as in the real function; the
    // block polls a health callback, supplied here pointed at the stub.
    const harness = [
      "set -uo pipefail",
      "health_check() {",
      '  local repo_dir="$1"',
      "  local health_fn=_stub_health",
      '  local log_hint="(test)"',
      '  local label="(test)"',
      block,
      "}",
      '_stub_health() { bash "${CREWRIG_REPO_DIR}/scripts/status-chroma-server.sh"; }',
      'CREWRIG_REPO_DIR="$1"',
      'health_check "$1"',
      "exit $?",
    ].join("\n");
    const r = spawnSync("bash", ["-c", harness, "harness", sandbox], {
      encoding: "utf8",
      timeout: 30_000,
      env: { ...process.env, HOME: sandbox, USERPROFILE: sandbox },
    });
    assert.equal(
      r.status,
      0,
      `rc=${r.status} on a daemon healthy after 2 s:\n${r.stdout}${r.stderr}`,
    );
  });

  test("the block contains a polling construct", () => {
    assert.match(block, /\b(while|until|for)\b|deadline=|SECONDS/);
  });
});

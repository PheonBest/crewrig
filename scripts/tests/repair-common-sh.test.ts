// repair-common-sh.test.ts — Retires with scripts/lib/common.sh (row J4).
// The Bash twins of the repair hand-off (spec 0165 R14; spec 0263 requirement 6,
// groups G12 and G16 of scripts/tests/test-repair-mempalace-http.sh):
// `mcp_assistant_arrangement`, `switch_assistants_to_http` and `_switch_rollback`
// are sourced from scripts/lib/common.sh in a scratch HOME. No TypeScript suite
// asserts these exact strings from common.sh, so the checks stay until the
// library is deleted. POSIX only: the library is Bash.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";
import { makeRig, REPO, RESIDUE, scratchRoot } from "./lib/repair-rig.ts";

const root = scratchRoot("crewrig-repair-commonsh-");
after(() => fs.rmSync(root, { recursive: true, force: true }));

function sourced(body: string, name: string): { status: number | null; out: string } {
  const r = makeRig(root, name, ["claude", "gemini", "copilot", "agy"]);
  fs.writeFileSync(r.gemini, RESIDUE);
  const lib = path.join(REPO, "scripts", "lib", "common.sh");
  const script = `set +e\nsource ${JSON.stringify(lib)}\n${body.replace("@CFG@", JSON.stringify(r.gemini))}`;
  const res = spawnSync("bash", ["-c", script], { env: r.env, encoding: "utf8", cwd: r.home });
  return { status: res.status, out: res.stdout + res.stderr };
}

describe(
  "common.sh repair hand-off",
  { skip: process.platform === "win32" && "bash library" },
  () => {
    test("G12: mcp_assistant_arrangement reads unknown for residue, then none for an empty server list", () => {
      const r = sourced(
        'a="$(mcp_assistant_arrangement gemini)"; echo "{\\"mcpServers\\":{}}" > @CFG@; printf "%s|%s" "$a" "$(mcp_assistant_arrangement gemini)"',
        "g12",
      );
      assert.equal(r.out.trim().split("\n").pop(), "unknown|none");
    });

    test("G16: switch_assistants_to_http refuses residue and names `task mempalace:repair`", () => {
      const r = sourced('switch_assistants_to_http "test-token"; echo "rc=$?"', "g16a");
      assert.match(r.out, /task mempalace:repair/);
      assert.doesNotMatch(r.out, /rc=0/);
    });

    test("G16: _switch_rollback with the config absent names `task mempalace:repair -- --restore-backup`", () => {
      const r = sourced('rm -f @CFG@; _switch_rollback "gemini" null null null null', "g16b");
      assert.ok(r.out.includes("task mempalace:repair -- --restore-backup"), r.out);
    });
  },
);

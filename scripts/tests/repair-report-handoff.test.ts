// repair-report-handoff.test.ts — the verification and hand-off half of
// `repair-mempalace-http` (spec 0165 R6, R7, R9, R14; spec 0263, port of groups
// G12, G15 and G16 of scripts/tests/test-repair-mempalace-http.sh): the
// resulting arrangement read back through the TypeScript reader, the
// post-repair verification lines, repeatability, and the two R14 hand-off
// strings the switch transaction prints. The groups already asserted by
// repair-verbs.test.ts (report-only, refusal, shapes, flags) are not repeated.
// The `common.sh` twins of the hand-off live in repair-common-sh.test.ts.

import assert from "node:assert/strict";
import fs from "node:fs";
import { after, describe, test } from "node:test";
import { assistantArrangement } from "../lib/service/assistant-arrangement.ts";
import { rollbackSwitch } from "../lib/service/switch-rollback.ts";
import { switchAssistants } from "../lib/service/switch-transaction.ts";
import { makeRig, RESIDUE, runRepair, scratchRoot, type Rig } from "./lib/repair-rig.ts";

const root = scratchRoot("crewrig-repair-handoff-");
after(() => fs.rmSync(root, { recursive: true, force: true }));
const rig = (name: string): Rig => makeRig(root, name, ["claude", "gemini", "copilot", "agy"]);
const posix = process.platform !== "win32";

describe("repair report: verification and repeatability", { skip: !posix && "bash shim" }, () => {
  test("G12 and G15: --reset-none leaves arrangement none, verifies it, and a second run is clean", () => {
    const r = rig("g12");
    fs.writeFileSync(r.gemini, RESIDUE);
    assert.equal(assistantArrangement("gemini", r.env, r.home), "unknown");
    const run = runRepair(r, ["--reset-none"]);
    assert.equal(run.status, 0);
    assert.equal(assistantArrangement("gemini", r.env, r.home), "none");
    const doc = JSON.parse(fs.readFileSync(r.gemini, "utf8")) as { mcpServers: object };
    assert.ok(!("mempalace" in doc.mcpServers));
    assert.match(run.out, /Post-repair verification/);
    assert.match(run.out, /gemini: none/);
    assert.equal(runRepair(r).status, 0, "R9: a second plain run finds no residue");
  });
});

describe("repair hand-off: the switch transaction names the repair command (R14)", () => {
  test("G16: an unrecognised arrangement is refused and names `task mempalace:repair`", () => {
    const r = rig("g16a");
    fs.writeFileSync(r.gemini, RESIDUE);
    const out: string[] = [];
    const code = switchAssistants("test-token", {
      rotate: false,
      repoDir: "",
      env: r.env,
      home: r.home,
      platform: process.platform,
      io: { out: (l) => void out.push(l), err: () => undefined },
    });
    assert.notEqual(code, 0);
    assert.ok(out.join("\n").includes("Run 'task mempalace:repair', then re-run. (R14)"));
  });

  test("G16: a failed restore names `task mempalace:repair -- --restore-backup` (the `--` is load-bearing)", () => {
    const r = rig("g16b");
    const out: string[] = [];
    rollbackSwitch(["gemini"], new Map(), r.home, r.env, { out: (l) => void out.push(l) });
    const text = out.join("\n");
    assert.ok(text.includes("gemini: RESTORE FAILED"));
    assert.ok(text.includes("'task mempalace:repair -- --restore-backup'"));
  });
});

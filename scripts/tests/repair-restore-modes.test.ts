// repair-restore-modes.test.ts — the restore half of `repair-mempalace-http`
// (spec 0165 R5; spec 0263 requirements 4-12, port of groups G2-G11 of
// scripts/tests/test-repair-mempalace-http.sh): which backup wins (lexical
// order, `.NN` suffixes), the mode the restored file gets (the backup's TARGET
// mode, 0600 for a token or an owner-unreadable mode), and that a symlinked
// destination is replaced rather than written through. Runs the bash shim in a
// scratch HOME under umask 077, so a mode that survives is propagated, not
// inherited. POSIX only: modes, symlinks, umask.

import assert from "node:assert/strict";
import fs from "node:fs";
import { after, describe, test } from "node:test";
import {
  lmodeOf,
  makeRig,
  modeOf,
  ownerUnreadable,
  RESIDUE,
  runRepair,
  scratchRoot,
  TOKEN_CFG,
  usable,
  type Rig,
} from "./lib/repair-rig.ts";

const root = scratchRoot("crewrig-repair-modes-");
after(() => fs.rmSync(root, { recursive: true, force: true }));
const posix = process.platform !== "win32";
const skip = !posix && "POSIX modes, symlinks, umask and the bash shim";

const rig = (name: string): Rig => makeRig(root, name, ["claude", "gemini", "copilot", "agy"]);
const entryOf = (r: Rig): unknown =>
  (JSON.parse(fs.readFileSync(r.gemini, "utf8")) as { mcpServers: { mempalace: unknown } })
    .mcpServers.mempalace;
const bak = (r: Rig, stamp: string, body: string, mode = 0o644): string => {
  const file = `${r.gemini}.bak.${stamp}`;
  fs.writeFileSync(file, body);
  fs.chmodSync(file, mode);
  return file;
};
const arg = (name: string): unknown => ({ command: "bash", args: [name] });

describe("repair restore: which backup wins", { skip }, () => {
  test("G2: the newest usable backup, its mode, exit 0 (umask 077, destination 0600)", () => {
    const r = rig("g2");
    fs.writeFileSync(`${r.gemini}.bak.20260101-000000`, "not json");
    bak(r, "20260102-000000", usable("older"));
    bak(r, "20260103-000000", usable("newer"));
    fs.writeFileSync(r.gemini, RESIDUE, { mode: 0o600 });
    const run = runRepair(r, ["--restore-backup"], "077");
    assert.deepEqual(entryOf(r), arg("newer"));
    assert.equal(modeOf(r.gemini), "644");
    assert.equal(run.status, 0);
  });

  test("G3: a '.NN' suffix on an older stamp does not shadow a newer unsuffixed stamp", () => {
    const r = rig("g3");
    bak(r, "20260102-000000.01", usable("middle"));
    bak(r, "20260103-000000", usable("newer"));
    fs.writeFileSync(r.gemini, RESIDUE);
    runRepair(r, ["--restore-backup"]);
    assert.deepEqual(entryOf(r), arg("newer"));
  });

  test("G3b: a '.NN' suffix on the newest stamp does win over its unsuffixed sibling", () => {
    const r = rig("g3b");
    bak(r, "20260103-000000", usable("first"));
    bak(r, "20260103-000000.01", usable("second"));
    fs.writeFileSync(r.gemini, RESIDUE);
    runRepair(r, ["--restore-backup"]);
    assert.deepEqual(entryOf(r), arg("second"));
  });

  test("G5: no usable backup is reported by name and exits non-zero", () => {
    const r = rig("g5");
    fs.writeFileSync(r.gemini, RESIDUE);
    const run = runRepair(r, ["--restore-backup"]);
    assert.notEqual(run.status, 0);
    assert.match(run.out, /gemini.*NO USABLE BACKUP/);
  });
});

describe("repair restore: token and symlink modes", { skip }, () => {
  test("G4: a restored config carrying a bearer token is 0600", () => {
    const r = rig("g4");
    bak(r, "20260103-000000", TOKEN_CFG("x"));
    fs.writeFileSync(r.gemini, RESIDUE);
    runRepair(r, ["--restore-backup"]);
    assert.equal(modeOf(r.gemini), "600");
  });

  test("G6: a symlinked destination is replaced, never written through", () => {
    const r = rig("g6");
    const victim = `${r.home}/victim-outside-the-config.json`;
    fs.writeFileSync(victim, RESIDUE, { mode: 0o600 });
    fs.symlinkSync(victim, r.gemini);
    bak(r, "20260104-000000", TOKEN_CFG("SECRET123"));
    runRepair(r, ["--restore-backup"]);
    assert.ok(!fs.readFileSync(victim, "utf8").includes("SECRET123"));
    assert.ok(!fs.lstatSync(r.gemini).isSymbolicLink());
    assert.equal(lmodeOf(r.gemini), "600");
  });

  test("G7: a symlinked backup restores with its TARGET's mode and content", () => {
    const r = rig("g7");
    const target = `${r.home}/dotfiles-settings.json`;
    fs.writeFileSync(target, usable("from-dotfiles"));
    fs.chmodSync(target, 0o644);
    fs.symlinkSync(target, `${r.gemini}.bak.20260105-000000`);
    fs.writeFileSync(r.gemini, RESIDUE, { mode: 0o600 });
    runRepair(r, ["--restore-backup"], "077");
    assert.deepEqual(entryOf(r), arg("from-dotfiles"));
    assert.equal(modeOf(r.gemini), "644");
  });

  test("G8: a symlinked backup whose target carries a token restores to 0600", () => {
    const r = rig("g8");
    const target = `${r.home}/dotfiles-settings-token.json`;
    fs.writeFileSync(target, TOKEN_CFG("x"));
    fs.chmodSync(target, 0o644);
    fs.symlinkSync(target, `${r.gemini}.bak.20260106-000000`);
    fs.writeFileSync(r.gemini, RESIDUE);
    runRepair(r, ["--restore-backup"]);
    assert.equal(modeOf(r.gemini), "600");
  });
});

describe("repair restore: an unsafe backup mode falls back to 0600", { skip }, () => {
  const cases: Array<[string, string, string]> = [
    ["G9: two-digit mode 060 (width)", "060", "20260107-000000"],
    ["G10: three-digit execute-only owner 100 (owner digit)", "100", "20260107-000000"],
    ["G11: four-digit setuid mode 4060 (owner digit is the second)", "4060", "20260108-000000"],
  ];
  for (const [title, want, stamp] of cases) {
    test(title, (t) => {
      const r = rig(`g-${want}`);
      const file = bak(r, stamp, usable(`mode-${want}`));
      const reason = ownerUnreadable(file, want);
      if (reason !== null) return t.skip(reason);
      fs.writeFileSync(r.gemini, RESIDUE);
      const run = runRepair(r, ["--restore-backup"], "077");
      assert.equal(run.status, 0, "R7: the restore converges");
      assert.deepEqual(entryOf(r), arg(`mode-${want}`), "readable by its owner");
      assert.equal(modeOf(r.gemini), "600");
    });
  }
});

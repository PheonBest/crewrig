// usage-capture-optin-safety.test.ts — write safety of the usage-capture opt-in (spec 0263, row J1b;
// port of sections 3 (l), (m), (o), (t) and (u) of test-setup-usage-capture-optin.sh: groups G18, G19,
// G21, G28, G29). Every assertion is on the bytes and modes the shipped entry leaves behind.
// G20 (library functions return, never exit, under `bash -e`) is a property of the Bash shim, pinned by
// setup-lib-shim-usage.test.ts, and is not ported.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";

import { backupFile } from "../lib/setup/backup.ts";
import {
  materialize,
  mergeSr,
  patchedManifest,
  REPO,
  runOptin,
  scratch,
  type Scratch,
} from "./lib/optin-fixtures.ts";
import { backups, cliEvents, fileMode, OPTIN_CLIS, type OptinCli } from "./lib/optin-oracle.ts";

const POSIX =
  process.platform === "win32" ? "POSIX mode bits and symlinks are not available on win32" : false;
const OLD_STAMP = "20200101-000000";
const roots: Scratch[] = [];
const fresh = (): Scratch => {
  const s = scratch();
  roots.push(s);
  return s;
};
after(() => roots.forEach((s) => s.cleanup()));

const footprint = (s: Scratch, cli: OptinCli): string => {
  const good = path.join(s.tmp, `${cli}-good.json`);
  materialize(`${cli}-coupled.json`, good, s.home);
  const r = runOptin("footprint", [cli, good], { env: s.env });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};

type Writer = "state" | "footprint" | "enable" | "keep" | "remove" | "reinject" | "merge";
const WRITERS: readonly Writer[] = [
  "state",
  "footprint",
  "enable",
  "keep",
  "remove",
  "reinject",
  "merge",
];

function run(s: Scratch, w: string, cli: OptinCli, cfg: string, fp: string, patched: string) {
  const env = { env: s.env };
  switch (w) {
    case "state":
    case "footprint":
    case "remove":
      return runOptin(w, [cli, cfg], env);
    case "enable":
    case "keep":
      return runOptin(w, [cli, cfg, REPO], env);
    case "reinject":
      return runOptin(w, [cli, cfg, fp], env);
    default:
      return mergeSr(s, cli, cfg, patched);
  }
}

describe("G18 unparsable input: every writer fails and leaves the file byte-identical", () => {
  for (const cli of OPTIN_CLIS) {
    for (const w of WRITERS) {
      it(`${cli} ${w}`, () => {
        const s = fresh();
        const patched = path.join(s.tmp, "patched.json");
        patchedManifest(cli, patched, s.home);
        const cfg = path.join(s.tmp, "cfg", "config.json");
        fs.mkdirSync(path.dirname(cfg), { recursive: true });
        const bytes = '{"hooks": {"Stop": [';
        fs.writeFileSync(cfg, bytes);
        const r = run(s, w, cli, cfg, footprint(s, cli), patched);
        assert.notEqual(r.status, 0, "non-zero status");
        assert.equal(fs.readFileSync(cfg, "utf8"), bytes);
      });
    }
  }
});

function seed(s: Scratch, cli: OptinCli, w: string, cfg: string, vanished: string): void {
  if (w === "enable" || w === "reinject") materialize(`${cli}-operator-stripped.json`, cfg, s.home);
  else if (w === "merge") materialize(`${cli}-operator.json`, cfg, s.home);
  else if (w.startsWith("keep")) materialize(`${cli}-coupled.json`, cfg, s.home, vanished);
  else materialize(`${cli}-coupled.json`, cfg, s.home);
}
const wname = (w: string): string => (w === "keep-repoint" ? "keep" : w);

describe("G19 file mode: 0600 stays 0600, 0644 ends 0600", { skip: POSIX }, () => {
  for (const cli of OPTIN_CLIS) {
    for (const mode of [0o600, 0o644]) {
      for (const w of ["enable", "remove", "keep-repoint", "reinject", "merge"]) {
        it(`${cli} ${w} on a 0${mode.toString(8)} file writes it and leaves it 0600`, () => {
          const s = fresh();
          const patched = path.join(s.tmp, "patched.json");
          patchedManifest(cli, patched, s.home);
          const cfg = path.join(s.tmp, "m", "config.json");
          seed(s, cli, w, cfg, path.join(s.tmp, "vanished", "hooks", "usage-capture.sh"));
          fs.chmodSync(cfg, mode);
          const before = fs.readFileSync(cfg, "utf8");
          const r = run(s, wname(w), cli, cfg, footprint(s, cli), patched);
          assert.equal(r.status, 0, r.stderr);
          assert.notEqual(fs.readFileSync(cfg, "utf8"), before, "the file changed");
          assert.equal(fileMode(cfg), 0o600);
        });
      }
    }
  }
});

describe("G21 every backup is 0600 and older backups are narrowed", { skip: POSIX }, () => {
  for (const cli of OPTIN_CLIS) {
    for (const w of ["enable", "keep", "remove", "merge"]) {
      it(`${cli} ${w}`, () => {
        const s = fresh();
        const patched = path.join(s.tmp, "patched.json");
        patchedManifest(cli, patched, s.home);
        const cfg = path.join(s.tmp, "o", "config.json");
        seed(s, cli, w, cfg, path.join(s.tmp, "vanished", "hooks", "usage-capture.sh"));
        fs.chmodSync(cfg, 0o644);
        const old = `${cfg}.bak.${OLD_STAMP}`;
        const oldBody = '{"Authorization":"Bearer OLD"}\n';
        fs.writeFileSync(old, oldBody);
        fs.chmodSync(old, 0o644);
        const r = run(s, w, cli, cfg, footprint(s, cli), patched);
        assert.equal(r.status, 0, r.stderr);
        const fresh1 = backups(cfg).filter((b) => b !== old);
        assert.equal(fresh1.length, 1, "exactly one new backup");
        assert.equal(fileMode(fresh1[0] ?? ""), 0o600, "the new backup of a 0644 source");
        assert.equal(fileMode(old), 0o600, "the older backup is narrowed");
        assert.equal(fs.readFileSync(old, "utf8"), oldBody);
      });
    }
  }
  it("backupFile on an absent target prints nothing, creates nothing, narrows older backups", () => {
    const s = fresh();
    const cfg = path.join(s.tmp, "absent", "settings.json");
    fs.mkdirSync(path.dirname(cfg), { recursive: true });
    const old = `${cfg}.bak.${OLD_STAMP}`;
    fs.writeFileSync(old, "old\n");
    fs.chmodSync(old, 0o644);
    const lines: string[] = [];
    const io = { out: (l: string) => void lines.push(l), err: (l: string) => void lines.push(l) };
    assert.equal(backupFile({ io }, cfg), "");
    assert.deepEqual(lines, []);
    assert.equal(fileMode(old), 0o600);
    assert.equal(backups(cfg).length, 1);
  });
});

describe("G28 a failed write leaves no temp file in the config directory", () => {
  for (const cli of OPTIN_CLIS) {
    for (const w of ["enable", "reinject"] as const) {
      it(`${cli} ${w}`, () => {
        const s = fresh();
        const dir = path.join(s.tmp, "t");
        const cfg = path.join(dir, "config.json");
        fs.mkdirSync(dir, { recursive: true });
        // Accepted by the pre-checks, rejected by the write ("hooks is not an object" / "not an array").
        const bytes =
          w === "enable"
            ? '{"hooks":"x"}\n'
            : `${JSON.stringify({ hooks: { [cliEvents(cli)[0] ?? ""]: "x" } })}\n`;
        fs.writeFileSync(cfg, bytes);
        const fp = footprint(s, cli);
        const r =
          w === "enable"
            ? runOptin(w, [cli, cfg, REPO], { env: s.env })
            : runOptin(w, [cli, cfg, fp], { env: s.env });
        assert.notEqual(r.status, 0);
        assert.equal(fs.readFileSync(cfg, "utf8"), bytes);
        assert.deepEqual(
          fs.readdirSync(dir).filter((f) => f.includes(".tmp")),
          [],
        );
        if (w === "enable")
          assert.ok(backups(cfg).length > 0, "enable reached the write step (a backup exists)");
      });
    }
  }
});

describe(
  "G29 a symlinked config: a regular 0600 file is written, the link target is untouched",
  { skip: POSIX },
  () => {
    for (const cli of OPTIN_CLIS) {
      it(cli, () => {
        const s = fresh();
        const target = path.join(s.tmp, "u", `${cli}-dotfiles`, "config.json");
        materialize(`${cli}-operator-stripped.json`, target, s.home);
        fs.chmodSync(target, 0o644);
        const orig = fs.readFileSync(target, "utf8");
        const cfg = path.join(s.tmp, "u", cli, "config.json");
        fs.mkdirSync(path.dirname(cfg), { recursive: true });
        fs.symlinkSync(target, cfg);
        const ext = path.join(s.tmp, "u", `${cli}-dotfiles`, "unrelated.json");
        fs.writeFileSync(ext, "{}\n");
        fs.chmodSync(ext, 0o644);
        fs.symlinkSync(ext, `${cfg}.bak.${OLD_STAMP}`);
        const r = runOptin("enable", [cli, cfg, REPO], { env: s.env });
        assert.equal(r.status, 0, r.stderr);
        const st = fs.lstatSync(cfg);
        assert.ok(st.isFile() && !st.isSymbolicLink(), "the link is replaced by a regular file");
        assert.equal(fileMode(cfg), 0o600);
        assert.equal(runOptin("state", [cli, cfg], { env: s.env }).stdout.trim(), "installed");
        assert.equal(fs.readFileSync(target, "utf8"), orig);
        assert.equal(fileMode(target), 0o644);
        const fresh1 = backups(cfg).filter((b) => !b.endsWith(`.bak.${OLD_STAMP}`));
        assert.equal(fresh1.length, 1);
        assert.ok(fs.lstatSync(fresh1[0] ?? "").isSymbolicLink(), "the backup is the link itself");
        assert.equal(fs.readlinkSync(fresh1[0] ?? ""), target);
        assert.equal(fileMode(ext), 0o644, "no narrowing followed a link");
      });
    }
  },
);

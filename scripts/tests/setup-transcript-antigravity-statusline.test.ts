// setup-transcript-antigravity-statusline.test.ts — the usage-capture statusline wiring of the
// Antigravity setup (spec 0206, 0243 R16, R19-R23), group G27 of the Bash suite
// test-setup-antigravity-transcript.sh (spec 0263), plus the two shim legs G28 A and D. The wiring is
// the real scripts/hook-wiring.ts; all settings and markers are scratch files. Modes are POSIX-only.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import { at, readJson } from "./lib/antigravity-transcript-rig.ts";
import {
  cleanEnv,
  cleanupAll,
  realTmp,
  REPO,
  runNode,
  SKIP_POSIX,
  WINDOWS,
} from "./lib/worktree-fixtures.ts";

after(cleanupAll);

const SHIM_TS = path.join(
  fs.realpathSync.native(path.join(REPO, "hooks")),
  "antigravity-statusline-shim.ts",
);
const SHIM_SH = path.join(
  fs.realpathSync.native(path.join(REPO, "hooks")),
  "antigravity-statusline-shim.sh",
);
const DIRECT = `node "${SHIM_TS}"`;
const NODE_FLAGS = [
  "--disable-warning=ExperimentalWarning",
  "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
];

interface Rig {
  readonly settings: string;
  readonly marker: string;
  readonly home: string;
}
function rig(): Rig {
  const home = realTmp("agy-statusline-");
  return {
    settings: path.join(home, "settings.json"),
    marker: path.join(home, "marker.json"),
    home,
  };
}
const wire = (r: Rig, verb: string) =>
  runNode(
    path.join(REPO, "scripts", "hook-wiring.ts"),
    ["statusline", verb, "--settings", r.settings, "--marker", r.marker, "--repo", REPO],
    {
      nodeArgs: NODE_FLAGS,
      env: cleanEnv({
        HOME: r.home,
        USERPROFILE: r.home,
        CREWRIG_USAGE_ROOT: path.join(r.home, "usage"),
      }),
    },
  );
const mode = (file: string): string => (fs.statSync(file).mode & 0o777).toString(8);

describe("install", () => {
  test("wires the direct node form, records the marker, keeps other keys", () => {
    const r = rig();
    fs.writeFileSync(r.settings, '{"theme":"dark"}');
    assert.equal(wire(r, "install").status, 0);
    assert.equal(at(readJson(r.settings), "statusLine", "command"), DIRECT);
    const marker = readJson(r.marker);
    assert.equal(marker["installedStatusLineCommand"], DIRECT);
    assert.equal(marker["priorStatusLineCommand"], "");
    assert.equal(readJson(r.settings)["theme"], "dark");
  });

  test(
    "leaves settings and marker at 0600",
    { skip: WINDOWS ? "NTFS has no POSIX mode bits" : false },
    () => {
      const r = rig();
      fs.writeFileSync(r.settings, '{"theme":"dark"}');
      wire(r, "install");
      assert.equal(mode(r.settings), "600");
      assert.equal(mode(r.marker), "600");
    },
  );

  test("refuses a foreign statusLine.command, changes nothing and writes no marker (R20)", () => {
    const r = rig();
    fs.writeFileSync(r.settings, '{"statusLine":{"command":"echo prior"}}');
    assert.notEqual(wire(r, "install").status, 0);
    assert.equal(at(readJson(r.settings), "statusLine", "command"), "echo prior");
    assert.equal(fs.existsSync(r.marker), false);
  });

  test("no antigravity-statusline-shim.sh appears under the scratch ~/.gemini/antigravity-cli", () => {
    const r = rig();
    fs.writeFileSync(r.settings, "{}");
    wire(r, "install");
    assert.equal(
      fs.existsSync(
        path.join(r.home, ".gemini", "antigravity-cli", "antigravity-statusline-shim.sh"),
      ),
      false,
    );
  });
});

describe("rewrite and the D5 crash states", { skip: SKIP_POSIX }, () => {
  const seed = (r: Rig, command: string, marker: object): void => {
    fs.writeFileSync(r.settings, JSON.stringify({ statusLine: { command }, keep: 1 }));
    fs.writeFileSync(r.marker, `${JSON.stringify(marker)}\n`);
  };
  const completes = (r: Rig): void => {
    assert.equal(wire(r, "rewrite").status, 0);
    assert.equal(at(readJson(r.settings), "statusLine", "command"), DIRECT);
    assert.equal(readJson(r.settings)["keep"], 1);
    const marker = readJson(r.marker);
    assert.equal(marker["installedStatusLineCommand"], DIRECT);
    assert.equal("previousInstalledStatusLineCommand" in marker, false);
  };
  const legacy = {
    priorStatusLineCommand: "echo prior",
    installedStatusLineCommand: SHIM_SH,
    installedBy: "t",
  };
  const both = {
    priorStatusLineCommand: "",
    installedStatusLineCommand: DIRECT,
    previousInstalledStatusLineCommand: SHIM_SH,
    installedBy: "t",
  };

  test("a bare .sh command becomes the direct form, keeps the prior command, and a second rewrite is a byte no-op", () => {
    const r = rig();
    seed(r, SHIM_SH, legacy);
    completes(r);
    assert.equal(readJson(r.marker)["priorStatusLineCommand"], "echo prior");
    const [s, m] = [fs.readFileSync(r.settings), fs.readFileSync(r.marker)];
    wire(r, "rewrite");
    assert.ok(s.equals(fs.readFileSync(r.settings)) && m.equals(fs.readFileSync(r.marker)));
  });

  test("crash (a): settings hold the old command, the marker names both; the next run completes", () => {
    const r = rig();
    seed(r, SHIM_SH, both);
    completes(r);
  });

  test("crash (b): settings already hold the new command; the next run drops the transitional key", () => {
    const r = rig();
    seed(r, DIRECT, both);
    completes(r);
  });

  test("a command that is neither recorded value is left byte-identical", () => {
    const r = rig();
    fs.writeFileSync(r.settings, '{"statusLine":{"command":"echo foreign"}}');
    fs.writeFileSync(
      r.marker,
      `${JSON.stringify({ priorStatusLineCommand: "", installedStatusLineCommand: SHIM_SH, installedBy: "t" })}\n`,
    );
    const before = fs.readFileSync(r.settings);
    wire(r, "rewrite");
    assert.ok(before.equals(fs.readFileSync(r.settings)));
  });
});

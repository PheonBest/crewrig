// mcp-daemon-static-guards.test.ts — groups G6, G7, G12 (structural), G13, G14
// (static) and G22 (structural) of the former scripts/tests/test-mcp-daemon.sh
// (spec 0263, row D): text guards over the unit files,
// the setup declarations and the HTTP wrapper. They read files and run no
// supervisor, so they run on every platform.
//
// G6 is the argv-credential static guard (spec 0149 R1, R2, issue #1247). Its
// sweep covers hooks/mempalace-transcript.ts and this
// suite's own files (the glob below, never empty), because a static guard
// belongs next to the dynamic argv-stub test (mempalace-transcript-hook.test.ts)
// that already exercises the same regression on that file. The one deliberate
// occurrence in the repository, scripts/tests/test-setup-org-mcp.sh, asserts
// the org-MCP argv shape on purpose and carries a comment saying so at its own
// call site (spec 0149 R4); no other occurrence exists under scripts/ or hooks/.
// Both halves of the banned string are concatenated at runtime so that this
// file cannot satisfy the search it performs.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import { REPO } from "./lib/worktree-fixtures.ts";

const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), "utf8");

// --- G6 ---------------------------------------------------------------------
const scheme = "Bea" + "rer";
const hdr = "Authoriz" + "ation";
const shapeA = new RegExp(`-(H|-header)[\\s=]*["']?${hdr}:.*${scheme}`, "i");
const shapeB = new RegExp(`--oauth2-${scheme.toLowerCase()}[\\s=]`, "i");
const shapeC = /curl.*\s-(u|-user)[\s=]+["']?[^"'\s]*:/i;
// Anchored comment filter: only a line that STARTS as a comment is excluded, so a
// violation with a trailing comment is still reported.
const COMMENT = /^\s*(#|\/\/|\*)/;

/** `<file>:<line>:<text>` per violating line; a missing path is a MISSING violation. */
function argvHits(files: readonly string[]): string[] {
  const all: string[] = [];
  for (const file of files) {
    if (!fs.existsSync(file)) {
      all.push(`${file}:0:MISSING — the guard swept a path that does not exist`);
      continue;
    }
    fs.readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (COMMENT.test(line)) return;
        if (shapeA.test(line) || shapeB.test(line) || shapeC.test(line))
          all.push(`${file}:${i + 1}:${line}`);
      });
  }
  return all;
}

function g6Fixture(): string {
  const lines = [
    `curl -H "${hdr.toLowerCase()}: ${scheme.toLowerCase()} $t" http://x`,
    `curl -H "${hdr}: ${scheme} $t" http://x  # ref: #913`,
    `  # prose: NOT curl -H "${hdr}: ${scheme} $t"`,
    `curl --oauth2-${scheme.toLowerCase()} "$t" http://x`,
    `curl -sS -${"u"} "svc:$t" http://x`,
  ];
  return lines.join("\n") + "\n";
}

describe("G6 argv credential static guard (R8, spec 0149, #1247)", () => {
  const fixtureDir = fs.mkdtempSync(
    path.join(fs.realpathSync(process.env["TMPDIR"] ?? "/tmp"), "argv-guard-"),
  );
  const fixture = path.join(fixtureDir, "f.txt");
  after(() => fs.rmSync(fixtureDir, { recursive: true, force: true }));
  fs.writeFileSync(fixture, g6Fixture());
  const self = hits(fixture);
  function hits(file: string): string[] {
    return argvHits([file]);
  }

  test("the guard catches a violation spelled in lower case (R1)", () => {
    assert.ok(self.some((h) => h.includes(`${hdr.toLowerCase()}: ${scheme.toLowerCase()}`)));
  });
  test("the guard catches a violation carrying a trailing comment (R2)", () => {
    assert.ok(self.some((h) => h.includes("# ref: #913")));
  });
  test("the guard catches curl's own token flag (shape B)", () => {
    assert.ok(self.some((h) => h.includes(`--oauth2-${scheme.toLowerCase()}`)));
  });
  test("the guard catches basic auth passed through argv (shape C)", () => {
    assert.ok(self.some((h) => h.includes('"svc:$t"')));
  });
  test("the anchored filter excludes the comment line and nothing else (R2)", () => {
    assert.equal(self.length, 4, `expected exactly 4 fixture violations: ${self.join("|")}`);
  });

  const testFiles = fs
    .readdirSync(path.join(REPO, "scripts", "tests"))
    .filter((n) => /^mcp-daemon-.*\.test\.ts$/.test(n))
    .map((n) => path.join(REPO, "scripts", "tests", n));
  const swept = [
    path.join(REPO, "hooks", "mempalace-transcript.ts"),
    path.join(REPO, "scripts", "tests", "lib", "mcp-daemon-rig.ts"),
    ...testFiles,
  ];

  test("every swept path exists and the suite's own files are read (not vacuous)", () => {
    const real = swept.filter((f) => fs.existsSync(f));
    assert.equal(real.length, swept.length, "a swept path does not exist");
    assert.ok(testFiles.length > 0, "the glob of this suite's files is empty");
    assert.ok(
      testFiles.includes(path.join(REPO, "scripts", "tests", "mcp-daemon-static-guards.test.ts")),
    );
  });
  test("no credential is passed through an argv flag (R8)", () => {
    assert.deepEqual(argvHits(swept), []);
  });
});

// --- G7 ---------------------------------------------------------------------
describe("G7 unit files carry no credential (R8)", () => {
  for (const unit of [
    "config/launchd/com.mempalace.mcp-server.plist",
    "config/systemd/mempalace-mcp-server.service",
  ]) {
    test(`${path.basename(unit)} carries no credential outside commentary`, () => {
      assert.ok(fs.existsSync(path.join(REPO, unit)), `${unit} must exist`);
      // Strip comments STRUCTURALLY (a plist body is indented, so an indented
      // line is not a comment): XML comments first, then `#` comment lines.
      const body = read(unit)
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/^[ \t]*#.*$/gm, "");
      assert.doesNotMatch(body, /token[=\s]*[A-Za-z0-9_-]{8,}|MEMPALACE_MCP_HTTP_TOKEN/i);
    });
  }
});

// --- G13 --------------------------------------------------------------------
const PRINTER = path.join(REPO, "scripts", "tests", "lib", "print-setup-declarations.ts");
const CLIS = ["claude", "gemini", "copilot", "antigravity"] as const;

function mcpSubsteps(cli: string): string[] {
  const res = spawnSync(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", PRINTER, cli],
    { encoding: "utf8" },
  );
  const line = res.stdout.split("\n").find((l) => l.startsWith("substeps.mcp="));
  return line === undefined ? [] : line.slice("substeps.mcp=".length).split(",");
}

describe("G13 setup scripts wire ensure_mempalace_http (delta-02 R17)", () => {
  test("all four setup declarations list ensure-mempalace-http in the mcp layer", () => {
    const missing = CLIS.filter((cli) => {
      const subs = mcpSubsteps(cli);
      return subs.length === 0 || !subs.includes("ensure-mempalace-http");
    });
    assert.deepEqual(missing, [], "a declaration is empty or dropped the HTTP-by-default wiring");
  });
  test("ensure-mempalace-http is ordered against its stdio write per CLI", () => {
    const anchors: Record<string, readonly [string, "before" | "after"]> = {
      claude: ["register-stdio-fallback", "before"],
      gemini: ["gemini-settings-write", "after"],
      copilot: ["write-mcp-config", "after"],
      antigravity: ["write-mcp-config", "after"],
    };
    const failures: string[] = [];
    for (const cli of CLIS) {
      const subs = mcpSubsteps(cli);
      const call = subs.indexOf("ensure-mempalace-http");
      const [anchorId, direction] = anchors[cli] ?? ["", "before"];
      const anchor = subs.indexOf(anchorId);
      if (call < 0) failures.push(`${cli}(no-call)`);
      else if (anchor < 0) failures.push(`${cli}(no-anchor)`);
      else if (direction === "before" ? !(call < anchor) : !(call > anchor)) failures.push(cli);
    }
    assert.deepEqual(failures, []);
  });
});

// --- G14 static -------------------------------------------------------------
describe("G14 static: the orphan reaper is not armed under HTTP", () => {
  test("`if not _transport_is_http():` guards the reaper", () => {
    assert.ok(
      read("scripts/lib/mempalace-http-wrapper.py").includes("if not _transport_is_http():"),
    );
  });
});

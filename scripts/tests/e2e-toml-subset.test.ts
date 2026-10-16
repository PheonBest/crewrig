// e2e-toml-subset.test.ts — unit tests of the TOML subset reader and of the merge (spec 0261 R6),
// plus a fuzz against `yq -p=toml -o=json` (mikefarah v4) on the committed .toml files.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { mergeValues, toJson, tomlMerge } from "../../tests/e2e/lib/toml_merge.ts";
import { parseToml, TomlError } from "../../tests/e2e/lib/toml_subset.ts";
import type { TomlTable } from "../../tests/e2e/lib/toml_subset.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const json = (text: string): unknown => JSON.parse(toJson(parseToml(text, "t.toml"), "yq"));
const refusal = (text: string): string => {
  try {
    parseToml(text, "t.toml");
  } catch (e) {
    if (e instanceof TomlError) return e.message;
    throw e;
  }
  return assert.fail("expected a refusal");
};

describe("toml_subset: accepted constructs", () => {
  it("reads tables, scalars and escapes", () => {
    const doc =
      '[a.b]\ns = "q\\"\\\\\\n\\t\\r\\u00e9"\nl = \'C:\\x\'\nt = true\ni = -3\nf = 1.50\nh = 0x1F\n';
    assert.deepEqual(json(doc), {
      a: { b: { s: 'q"\\\n\t\ré', l: "C:\\x", t: true, i: -3, f: 1.5, h: 31 } },
    });
  });
  it("reads multi-line arrays with comments and a trailing comma", () => {
    assert.deepEqual(json('a = [\n  # c\n  "x", # d\n  "y",\n]\ne = []\n'), {
      a: ["x", "y"],
      e: [],
    });
  });
  it("keeps a # inside a string", () => {
    assert.deepEqual(json("a = \"x # y\" # real\nb = '#'\n"), { a: "x # y", b: "#" });
  });
  it("accepts CRLF", () => {
    assert.deepEqual(json('[a]\r\nb = [\r\n  "1",\r\n]\r\n'), { a: { b: ["1"] } });
  });
  it("lets a repeated key win and a repeated table continue", () => {
    assert.deepEqual(json("[a]\nx = 1\n[a]\nx = 2\ny = 3\n"), { a: { x: 2, y: 3 } });
  });
});

describe("toml_subset: refused constructs", () => {
  const cases: Array<[string, string, string]> = [
    ["date", "d = 1979-05-27\n", "t.toml:1: unsupported construct: date or time"],
    ["time", "d = 07:32:00\n", "t.toml:1: unsupported construct: date or time"],
    ["multi-line basic", 's = """\na"""\n', "t.toml:1: unsupported construct: multi-line string"],
    [
      "multi-line literal",
      "\ns = '''\na'''\n",
      "t.toml:2: unsupported construct: multi-line string",
    ],
    ["inline table", "t = { a = 1 }\n", "t.toml:1: unsupported construct: inline table"],
    ["array of tables", "[[s]]\n", "t.toml:1: unsupported construct: array of tables"],
    ["dotted key", "a.b = 1\n", "t.toml:1: unsupported construct: dotted key"],
    ["quoted key", '"a b" = 1\n', "t.toml:1: unsupported construct: quoted key"],
    ["nested array", "a = [\n  [1],\n]\n", "t.toml:2: unsupported construct: nested array"],
    ["inf", "a = inf\n", "t.toml:1: unsupported construct: special float (inf, nan)"],
  ];
  for (const [name, text, message] of cases) {
    it(name, () => assert.equal(refusal(text), message));
  }
  it("names the line of a syntax error", () => {
    assert.match(refusal("[a]\nx = \n"), /^t\.toml:2: syntax error/);
    assert.match(refusal("[a\n"), /^t\.toml:1: syntax error/);
  });
});

describe("toml_merge: semantics", () => {
  it("appends arrays and replaces scalars", () => {
    const m = mergeValues(
      parseToml('a = ["x"]\ns = 1\n', "d"),
      parseToml('a = ["x", "y"]\ns = 2\n', "l"),
    );
    assert.deepEqual(JSON.parse(toJson(m, "jq")), { a: ["x", "x", "y"], s: 2 });
  });
});

function yqUsable(): string | null {
  try {
    const v = execFileSync("yq", ["--version"], { encoding: "utf8" });
    return /mikefarah/.test(v) && /version v?4\./.test(v) ? null : "yq is not mikefarah v4";
  } catch {
    return "yq is not installed";
  }
}
const skip = yqUsable() ?? false;
const yq = (file: string): unknown =>
  JSON.parse(execFileSync("yq", ["-p=toml", "-o=json", ".", file], { encoding: "utf8" }));

// yq v4.54 keeps a float token (`0.0`), the recorded yq printed it as a number (`0`): the fuzz
// compares parsed JSON, so the number's value counts, not its spelling.
describe("toml_subset: fuzz against yq", { skip }, () => {
  const tracked = execFileSync("git", ["ls-files", "*.toml"], { cwd: REPO, encoding: "utf8" })
    .split("\n")
    .filter((f) => f !== "");
  for (const f of tracked) {
    it(f, () => {
      let doc: TomlTable;
      try {
        doc = parseToml(fs.readFileSync(path.join(REPO, f), "utf8"), f);
      } catch (e) {
        assert.ok(e instanceof TomlError, "a refusal, never a crash");
        assert.match(e.message, new RegExp(`^${f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\d+: `));
        return;
      }
      assert.deepEqual(JSON.parse(toJson(doc, "yq")), yq(path.join(REPO, f)));
    });
  }
});

function shellUsable(): string | null {
  const probe = (cmd: string, args: string[]) => spawnSync(cmd, args, { encoding: "utf8" });
  const bash = probe("bash", ["-c", 'echo "${BASH_VERSINFO[0]}"']);
  if (bash.status !== 0 || Number(bash.stdout.trim()) < 4) return "bash >= 4 is required";
  if (probe("jq", ["--version"]).status !== 0) return "jq is not installed";
  return yqUsable();
}

// The expected side is the real shell pipeline (yq merge plus the jq fixups), not a bare yq merge.
describe("toml_merge: against the shell pipeline", { skip: shellUsable() ?? false }, () => {
  const fixtures = path.join(REPO, "scripts", "tests", "fixtures", "e2e-oracle", "libs", "toml");
  const defaults = path.join(REPO, "tests", "e2e", "defaults.toml");
  for (const name of fs
    .readdirSync(fixtures)
    .filter((n) => n.startsWith("local-") && n.endsWith(".golden"))) {
    it(`defaults.toml merged with ${name}`, () => {
      const local = path.join(fixtures, name);
      const shell = spawnSync(
        "bash",
        [path.join(REPO, "tests/e2e/lib/toml_merge.sh"), defaults, local],
        {
          encoding: "utf8",
          env: { ...process.env, LC_ALL: "C" },
        },
      );
      assert.equal(shell.status, 0, shell.stderr);
      const twin = tomlMerge([defaults, local], REPO, {});
      assert.equal(twin.rc, 0, twin.stderr);
      assert.deepEqual(JSON.parse(twin.stdout), JSON.parse(shell.stdout));
    });
  }
});

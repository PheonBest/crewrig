// e2e-oracle-libs-cases-toml.ts — cases of tests/e2e/lib/toml_merge.sh run as a script (spec 0261
// R6 and R9). Inventory: test-e2e-toml-merge.sh (cases 1-7), test-e2e-judge-config.sh (defaults
// pass-through), plus the spec R6 grammar. The shell reads TOML through yq, so the negative cases
// record what yq accepts; the TypeScript reader refuses them (deviation (b) of the plan). Big
// inputs are generated fixtures (`*.golden`, so the repository `.toml` fuzz never sees them).

import fs from "node:fs";
import path from "node:path";

import type { LibCase } from "./e2e-oracle-libs-types.ts";

const LIB = "tests/e2e/lib/toml_merge.sh";
const FIX = path.join(import.meta.dirname, "..", "fixtures", "e2e-oracle", "libs", "toml");
const fixture = (name: string) => fs.readFileSync(path.join(FIX, name), "latin1");

const DEF = '[cli.claude]\nimage = "X"\n';
const toml = (
  id: string,
  defaults: string,
  local: string | null,
  extra: Partial<LibCase> = {},
): LibCase => ({
  id: `toml/${id}`,
  lib: LIB,
  fn: "",
  script: true,
  tools: ["yq", "jq"],
  args: local === null ? ["defaults.toml"] : ["defaults.toml", "local.toml"],
  seed: [
    { path: "defaults.toml", content: defaults },
    ...(local === null ? [] : [{ path: "local.toml", content: local }]),
  ],
  ...extra,
});

const negative = (id: string, body: string) =>
  toml(`unsupported-${id}`, DEF, `[cli.claude]\n${body}\n`);

export const cases: LibCase[] = [
  toml("defaults-alone", fixture("defaults.toml.golden"), null),
  toml(
    "defaults-with-example-first-block",
    fixture("defaults.toml.golden"),
    fixture("local-uncommented-first.toml.golden"),
  ),
  toml(
    "defaults-with-example-all-blocks",
    fixture("defaults.toml.golden"),
    fixture("local-uncommented-all.toml.golden"),
  ),
  toml(
    "defaults-with-example-as-shipped",
    fixture("defaults.toml.golden"),
    fixture("local-example.toml.golden"),
  ),
  toml("empty-local", '[cli.claude]\nimage = "X"\nmounts = ["a"]\n', ""),
  toml("array-append", '[cli.claude]\nmounts = ["a"]\n', '[cli.claude]\nmounts = ["b"]\n'),
  toml(
    "array-append-duplicate-mount",
    '[cli.claude]\nmounts = ["a"]\n',
    '[cli.claude]\nmounts = ["a", "b"]\n',
  ),
  toml(
    "scalar-override",
    '[cli.claude]\nimage    = "X"\ncommand  = ["claude"]\nenv_keys = ["ANTHROPIC_API_KEY"]\n',
    '[cli.claude]\nimage = "Y"\n',
  ),
  toml(
    "env-keys-dedup-order",
    '[cli.claude]\nenv_keys = ["Z", "A"]\n',
    '[cli.claude]\nenv_keys = ["A", "M"]\n',
  ),
  toml(
    "env-keys-dedup-inside-defaults",
    '[cli.claude]\nenv_keys = ["A", "A", "B"]\n',
    '[cli.claude]\nimage = "Y"\n',
  ),
  toml(
    "env-keys-dedup-local-only-duplicates",
    '[cli.claude]\nimage = "X"\n',
    '[cli.claude]\nenv_keys = ["A", "B", "A"]\n',
  ),
  toml(
    "command-replaced",
    '[cli.claude]\ncommand = ["claude", "-p"]\nimage = "X"\n',
    '[cli.claude]\ncommand = ["bash"]\n',
  ),
  toml("command-new-cli", DEF, '[cli.other]\ncommand = ["x", "y"]\nenv_keys = ["K", "K"]\n'),
  toml(
    "local-mount-env-keys-command",
    '[cli.claude]\ncommand = ["claude"]\nmounts = ["a:b"]\nenv_keys = ["A", "B"]\n',
    '[cli.claude]\ncommand = ["sh", "-c", "x"]\nmounts = ["c:d:ro"]\nenv_keys = ["B", "C"]\n',
  ),
  toml("key-add", DEF, '[cli.claude]\nextra = "new"\n\n[cli.brand_new]\nimage = "Z"\n'),
  toml("table-without-cli", DEF, '[judge]\nbackend = "gemini"\n'),
  toml("defaults-without-cli", "[judge]\nstrict = false\n", "[judge]\nstrict = true\n"),
  toml("missing-local", DEF, "", {
    args: ["defaults.toml", "no-such-local.toml"],
    seed: [{ path: "defaults.toml", content: DEF }],
  }),
  toml("no-local-arg", DEF, null),
  toml(
    "crlf-defaults-and-local",
    '[cli.claude]\r\nimage = "X"\r\nmounts = ["a"]\r\n',
    '[cli.claude]\r\nmounts = [\r\n  "b",\r\n]\r\n',
  ),
  toml(
    "hash-inside-string",
    "[cli.claude]\nimage = \"a#b\" # trailing\nnote = 'x # y'\n",
    '[cli.claude]\nextra = "#not-a-comment" # real comment\n',
  ),
  toml(
    "scalars-and-escapes",
    '[t]\ni = 42\nf = 1.50\nneg = -3\nexp = 1e3\nb = true\ns = "q\\"b\\\\n\\t\\u00e9"\nl = \'C:\\x\'\n',
    "[t]\nf = 2.0\n",
  ),
  toml(
    "multiline-array-comments-trailing-comma",
    '[t]\na = [\n  # c1\n  "x", # c2\n  "y",\n]\n',
    '[t]\na = ["z"]\n',
  ),
  toml("duplicate-table-in-local", DEF, '[cli.claude]\nimage = "A"\n[cli.claude]\nimage = "B"\n'),
  toml("malformed-defaults", '[cli.claude\nimage = "X"\n', null),
  toml("malformed-local", DEF, '[cli.claude\nimage = "Y"\n'),
  toml("missing-defaults", DEF, null, { args: ["no-such-defaults.toml"], seed: [] }),
  toml("usage-no-args", DEF, null, { args: [], seed: [] }),
  toml("usage-three-args", DEF, null, { args: ["a", "b", "c"], seed: [] }),
  // Constructs the TypeScript reader refuses (R6); the shell accepts them through yq.
  negative("date", "d = 1979-05-27"),
  negative("datetime", "d = 1979-05-27T07:32:00Z"),
  negative("multiline-basic-string", 's = """\na\nb"""'),
  negative("multiline-literal-string", "s = '''\na\nb'''"),
  negative("inline-table", "t = { a = 1, b = 2 }"),
  negative("dotted-key", "a.b = 1"),
  negative("quoted-key", '"a b" = 1'),
  negative("nested-array", "a = [[1], [2]]"),
  toml("unsupported-array-of-tables", DEF, '[[servers]]\nname = "a"\n\n[[servers]]\nname = "b"\n'),
  toml("unsupported-date-in-defaults", "[a]\nd = 1979-05-27\n", null),
];

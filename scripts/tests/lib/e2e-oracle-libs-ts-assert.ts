// e2e-oracle-libs-ts-assert.ts — bindings of the library cases of one group to their TypeScript twins.
//
// The goldens were recorded by the shell under LC_ALL=C: bash saw the UTF-8 bytes of every
// argument and printed bytes, which the recorder read back as latin1. The binding reproduces that
// view: text arguments and stdin go in as their latin1-per-byte form, and any character the twin
// prints beyond U+00FF (its own `…`, `—`, `✨`) is turned into the latin1 form of its UTF-8 bytes.

import path from "node:path";

import {
  assertDiag,
  assertDrawerField,
  assertDrawerPresent,
  assertExitCode,
  assertFileAbsent,
  assertFileContains,
  assertFileExists,
  assertGitBranchPushed,
  truncate,
} from "../../../tests/e2e/lib/assert.ts";
import { expandMount } from "../../../tests/e2e/lib/expand.ts";
import {
  assertGitmojiTitle,
  assertJsonShape,
  assertStdoutMatches,
} from "../../../tests/e2e/lib/structural.ts";
import { REPO_ROOT } from "./e2e-oracle-libs-observe.ts";
import type { Binding, BindContext, BindResult } from "./e2e-oracle-libs-ts.ts";

const ASSERT = "tests/e2e/lib/assert.sh";
const STRUCT = "tests/e2e/lib/structural.sh";
const EXPAND = "tests/e2e/lib/expand.sh";

const bytesOf = (s: string): string => Buffer.from(s, "utf8").toString("latin1");
const toBytes = (s: string): string => s.replace(/[^\u0000-ÿ]/gu, bytesOf);

/** Line of each `${n:?}` of the shell libraries, by `<function>/<position>`. */
const LINES: Readonly<Record<string, number>> = {
  "assert_file_exists/1": 69,
  "assert_file_absent/1": 81,
  "assert_file_contains/1": 93,
  "assert_file_contains/2": 94,
  "assert_exit_code/1": 115,
  "assert_exit_code/2": 116,
  "assert_drawer_present/1": 153,
  "assert_drawer_present/2": 154,
  "assert_drawer_present/3": 155,
  "assert_drawer_field/1": 177,
  "assert_drawer_field/2": 178,
  "assert_drawer_field/3": 179,
  "assert_drawer_field/4": 180,
  "assert_drawer_field/5": 181,
  "assert_git_branch_pushed/1": 207,
  "assert_git_branch_pushed/2": 208,
  "assert_stdout_matches/1": 56,
  "assert_json_shape/1": 85,
  "assert_json_shape/2": 86,
  "assert_json_shape/3": 87,
  "assert_gitmoji_title/1": 125,
};

interface Plain {
  readonly rc: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Put bash's `<file>: line N: ` in front of an abort, and give the streams their byte view. */
function shellView(res: Plain, file: string): BindResult {
  let stderr = res.stderr;
  if (res.rc === 127) {
    const m = /^(\d+): (\w+): /.exec(stderr);
    const line = m === null ? undefined : LINES[`${m[2]}/${m[1]}`];
    if (line !== undefined) stderr = `${path.join(REPO_ROOT, file)}: line ${line}: ${stderr}`;
  }
  return { rc: res.rc, stdout: toBytes(res.stdout), stderr: toBytes(stderr) };
}

const arg = (a: readonly string[], i: number): string => a[i] ?? "";
const opts = (c: BindContext) => ({ cwd: c.work, env: c.env });

type Fn = (a: readonly string[], c: BindContext) => Plain;

function bind(file: string, lib: string, name: string, fn: Fn): Record<string, Binding> {
  return { [`${lib}#${name}`]: (a, c) => shellView(fn(a, c), file) };
}

export const bindings: Record<string, Binding> = {
  ...bind(ASSERT, ASSERT, "assert_file_exists", (a, c) => assertFileExists(arg(a, 0), opts(c))),
  ...bind(ASSERT, ASSERT, "assert_file_absent", (a, c) => assertFileAbsent(arg(a, 0), opts(c))),
  ...bind(ASSERT, ASSERT, "assert_file_contains", (a, c) =>
    assertFileContains(arg(a, 0), arg(a, 1), opts(c)),
  ),
  ...bind(ASSERT, ASSERT, "assert_exit_code", (a, c) =>
    assertExitCode(arg(a, 0), arg(a, 1), opts(c)),
  ),
  ...bind(ASSERT, ASSERT, "assert_drawer_present", (a, c) =>
    assertDrawerPresent(arg(a, 0), arg(a, 1), arg(a, 2), opts(c)),
  ),
  ...bind(ASSERT, ASSERT, "assert_drawer_field", (a, c) =>
    assertDrawerField(arg(a, 0), arg(a, 1), arg(a, 2), arg(a, 3), arg(a, 4), opts(c)),
  ),
  ...bind(ASSERT, ASSERT, "assert_git_branch_pushed", (a, c) =>
    assertGitBranchPushed(arg(a, 0), arg(a, 1), opts(c)),
  ),
  ...bind(ASSERT, ASSERT, "_e2e_assert_diag", (a, c) => ({
    rc: 0,
    stdout: "",
    stderr: assertDiag(
      bytesOf(arg(a, 0)),
      bytesOf(arg(a, 1)),
      bytesOf(arg(a, 2)),
      bytesOf(arg(a, 3)),
      c.env,
    ),
  })),
  ...bind(ASSERT, ASSERT, "_e2e_truncate", (a) => ({
    rc: 0,
    stdout: truncate(bytesOf(arg(a, 0))),
    stderr: "",
  })),
  ...bind(STRUCT, STRUCT, "assert_stdout_matches", (a, c) =>
    assertStdoutMatches(bytesOf(arg(a, 0)), arg(a, 1), bytesOf(c.stdin), opts(c)),
  ),
  ...bind(STRUCT, STRUCT, "assert_json_shape", (a, c) =>
    assertJsonShape(arg(a, 0), arg(a, 1), arg(a, 2), opts(c)),
  ),
  ...bind(STRUCT, STRUCT, "assert_gitmoji_title", (a, c) =>
    assertGitmojiTitle(bytesOf(arg(a, 0)), opts(c)),
  ),
  ...bind(EXPAND, EXPAND, "expand_mount", (a, c) => {
    const res = expandMount(arg(a, 0), c.env["E2E_CREWRIG_E2E_HOME"] ?? "", c.env["HOME"] ?? "");
    return res.rc === 127
      ? { ...res, stderr: `${path.join(REPO_ROOT, EXPAND)}: line 32: ${res.stderr}` }
      : res;
  }),
};

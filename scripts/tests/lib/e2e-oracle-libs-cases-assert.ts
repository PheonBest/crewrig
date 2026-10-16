// e2e-oracle-libs-cases-assert.ts — library cases for assert.sh, structural.sh and expand.sh
// (spec 0261 R9). Every behaviour asserted by test-e2e-assert-lib.sh and test-e2e-structural-lib.sh
// is recorded here, plus the rows of PLAN v3 Table 1 that had no recorded case. The shell leg needs
// bash >= 4; the `# FAIL` diagnostic block is recorded verbatim through stderr.

import { createHash } from "node:crypto";
import zlib from "node:zlib";

import type { LibCase, LibSeedFile } from "./e2e-oracle-libs-types.ts";

const ASSERT = "tests/e2e/lib/assert.sh";
const STRUCT = "tests/e2e/lib/structural.sh";
const EXPAND = "tests/e2e/lib/expand.sh";

/** Seed content is written as latin1: turn a UTF-8 string into its byte-per-char form. */
export const bytes = (s: string): string => Buffer.from(s, "utf8").toString("latin1");

/** PATH without any `mempalace`; an empty PATH would stop the sandbox from starting bash. */
const NO_MEMPALACE = { PATH: "/usr/bin:/bin" };

function gitObject(kind: string, body: Buffer): { sha: string; file: LibSeedFile } {
  const raw = Buffer.concat([Buffer.from(`${kind} ${body.length}\0`), body]);
  const sha = createHash("sha1").update(raw).digest("hex");
  const content = zlib.deflateSync(raw).toString("latin1");
  return { sha, file: { path: `remote.git/objects/${sha.slice(0, 2)}/${sha.slice(2)}`, content } };
}

/** A bare repository with one commit on `main`, built from plain files (no git needed to seed). */
function bareRepo(): readonly LibSeedFile[] {
  const tree = gitObject("tree", Buffer.alloc(0));
  const who = "A <a@example.invalid> 0 +0000";
  const body = `tree ${tree.sha}\nauthor ${who}\ncommitter ${who}\n\nseed\n`;
  const commit = gitObject("commit", Buffer.from(body));
  return [
    { path: "remote.git/HEAD", content: "ref: refs/heads/main\n" },
    {
      path: "remote.git/config",
      content: "[core]\n\trepositoryformatversion = 0\n\tbare = true\n",
    },
    { path: "remote.git/refs/heads/main", content: `${commit.sha}\n` },
    tree.file,
    commit.file,
  ];
}

const call = (id: string, lib: string, fn: string, rest: Partial<LibCase> = {}): LibCase => ({
  id,
  lib,
  fn,
  ...rest,
});
const present: LibSeedFile = { path: "present", content: "" };
const hay: LibSeedFile = { path: "hay", content: "alpha\nbeta\n" };
const json = (path: string, content: string): LibSeedFile => ({ path, content });
const long = "x".repeat(250);

export const cases: LibCase[] = [
  // assert.sh — file assertions
  call("assert/file-exists-pass", ASSERT, "assert_file_exists", {
    args: ["present"],
    seed: [present],
  }),
  call("assert/file-exists-fail", ASSERT, "assert_file_exists", { args: ["absent"] }),
  call("assert/file-exists-missing-arg", ASSERT, "assert_file_exists"),
  call("assert/file-absent-pass", ASSERT, "assert_file_absent", { args: ["absent"] }),
  call("assert/file-absent-fail", ASSERT, "assert_file_absent", {
    args: ["present"],
    seed: [present],
  }),
  call("assert/file-contains-pass", ASSERT, "assert_file_contains", {
    args: ["hay", "^beta$"],
    seed: [hay],
  }),
  call("assert/file-contains-no-match", ASSERT, "assert_file_contains", {
    args: ["hay", "^zzz$"],
    seed: [hay],
  }),
  call("assert/file-contains-no-match-long", ASSERT, "assert_file_contains", {
    args: ["big", "^zzz$"],
    seed: [{ path: "big", content: `${long}\nsecond line\n` }],
  }),
  call("assert/file-contains-absent-file", ASSERT, "assert_file_contains", {
    args: ["absent", "x"],
  }),
  call("assert/file-contains-missing-regex", ASSERT, "assert_file_contains", {
    args: ["hay"],
    seed: [hay],
  }),
  // assert.sh — exit codes
  call("assert/exit-code-equal", ASSERT, "assert_exit_code", { args: ["0", "0"] }),
  call("assert/exit-code-differ", ASSERT, "assert_exit_code", { args: ["0", "1"] }),
  call("assert/exit-code-missing-actual", ASSERT, "assert_exit_code", { args: ["0"] }),
  // assert.sh — MemPalace probes without the binary (a case never reaches a real palace)
  call("assert/drawer-present-no-mempalace", ASSERT, "assert_drawer_present", {
    args: ["wing", "room", "key: v"],
    env: NO_MEMPALACE,
  }),
  call("assert/drawer-field-no-mempalace", ASSERT, "assert_drawer_field", {
    args: ["wing", "room", "handoff-1", "status", "done"],
    env: NO_MEMPALACE,
  }),
  call("assert/drawer-field-missing-arg", ASSERT, "assert_drawer_field", {
    args: ["wing", "room", "handoff-1", "status"],
    env: NO_MEMPALACE,
  }),
  // assert.sh — git remote: a bare repository seeded as plain files inside the sandbox
  call("assert/git-branch-pushed-present", ASSERT, "assert_git_branch_pushed", {
    args: ["remote.git", "main"],
    seed: bareRepo(),
    tools: ["git"],
  }),
  call("assert/git-branch-pushed-absent-branch", ASSERT, "assert_git_branch_pushed", {
    args: ["remote.git", "__no_such_branch_zzz__"],
    seed: bareRepo(),
    tools: ["git"],
  }),
  call("assert/git-branch-pushed-unreachable-remote", ASSERT, "assert_git_branch_pushed", {
    args: ["missing.git", "main"],
    tools: ["git"],
  }),
  // assert.sh — private helpers, recorded directly (report line, truncation, newline collapse)
  call("assert/diag-no-report-dir", ASSERT, "_e2e_assert_diag", {
    args: ["name argv", "want", "got"],
  }),
  call("assert/diag-report-dir", ASSERT, "_e2e_assert_diag", {
    args: ["name argv", "want", "got", "art.txt"],
    env: { E2E_REPORT_DIR: "/reports/run1" },
  }),
  call("assert/diag-report-dir-no-artefact", ASSERT, "_e2e_assert_diag", {
    args: ["name argv", "want", "got"],
    env: { E2E_REPORT_DIR: "/reports/run1" },
  }),
  call("assert/diag-artefact-without-report-dir", ASSERT, "_e2e_assert_diag", {
    args: ["name argv", "want", "got", "art.txt"],
  }),
  call("assert/diag-truncates-long", ASSERT, "_e2e_assert_diag", { args: ["n", long, long] }),
  call("assert/truncate-collapses-newlines", ASSERT, "_e2e_truncate", { args: ["a\nb\nc"] }),
  call("assert/truncate-exactly-200", ASSERT, "_e2e_truncate", { args: ["y".repeat(200)] }),
  call("assert/truncate-201", ASSERT, "_e2e_truncate", { args: ["y".repeat(201)] }),
  call("assert/truncate-multibyte", ASSERT, "_e2e_truncate", { args: [bytes("é".repeat(120))] }),

  // structural.sh — assert_stdout_matches (stdin and file forms)
  call("structural/stdout-matches-stdin-pass", STRUCT, "assert_stdout_matches", {
    args: ["^alpha-"],
    stdin: "alpha-line\n",
  }),
  call("structural/stdout-matches-stdin-miss", STRUCT, "assert_stdout_matches", {
    args: ["^zzz$"],
    stdin: "alpha-line\n",
  }),
  call("structural/stdout-matches-stdin-empty", STRUCT, "assert_stdout_matches", {
    args: ["^a"],
    stdin: "",
  }),
  call("structural/stdout-matches-file-pass", STRUCT, "assert_stdout_matches", {
    args: ["^gamma$", "fx"],
    seed: [{ path: "fx", content: "gamma\n" }],
  }),
  call("structural/stdout-matches-file-miss", STRUCT, "assert_stdout_matches", {
    args: ["^delta$", "fx"],
    seed: [{ path: "fx", content: "gamma\n" }],
  }),
  call("structural/stdout-matches-file-absent", STRUCT, "assert_stdout_matches", {
    args: ["x", "nope"],
  }),
  call("structural/stdout-matches-missing-regex", STRUCT, "assert_stdout_matches"),
  // structural.sh — assert_json_shape (jq): the four fixtures plus the error and missing-file paths
  call("structural/json-shape-empty-object", STRUCT, "assert_json_shape", {
    args: ["empty.json", ".", "{}"],
    seed: [json("empty.json", "{}\n")],
    tools: ["jq"],
  }),
  call("structural/json-shape-match", STRUCT, "assert_json_shape", {
    args: ["one.json", ".a", "1"],
    seed: [json("one.json", '{"a":1}\n')],
    tools: ["jq"],
  }),
  call("structural/json-shape-mismatch", STRUCT, "assert_json_shape", {
    args: ["one.json", ".a", "2"],
    seed: [json("one.json", '{"a":1}\n')],
    tools: ["jq"],
  }),
  call("structural/json-shape-absent-file", STRUCT, "assert_json_shape", {
    args: ["missing.json", ".", "{}"],
    tools: ["jq"],
  }),
  call("structural/json-shape-jq-error", STRUCT, "assert_json_shape", {
    args: ["bad.json", ".a", "1"],
    seed: [json("bad.json", "not json\n")],
    tools: ["jq"],
  }),
  // structural.sh — assert_gitmoji_title; `grep -P` needs GNU grep (the e2e-base image), not BSD grep
  ...[
    ["pass-docker", "🐳 Add docker"],
    ["pass-sparkles", "✨ Initial commit"],
    ["fail-no-emoji", "Add foo"],
    ["fail-emoji-only", "🐳"],
    ["fail-emoji-no-text", "🐳 "],
  ].map(([name, title]) =>
    call(`structural/gitmoji-${name}`, STRUCT, "assert_gitmoji_title", {
      args: [bytes(title ?? "")],
      tools: ["grep"],
    }),
  ),

  // expand.sh — token expansion
  call("expand/both-tokens", EXPAND, "expand_mount", {
    args: ["${CREWRIG_E2E_HOME}/a:${HOME}/b:ro"],
    env: { E2E_CREWRIG_E2E_HOME: "/bundle", HOME: "/h/u" },
  }),
  call("expand/no-tokens", EXPAND, "expand_mount", {
    args: ["/plain/path:/x"],
    env: { E2E_CREWRIG_E2E_HOME: "/bundle" },
  }),
  call("expand/repeated-token", EXPAND, "expand_mount", {
    args: ["${HOME}:${HOME}"],
    env: { E2E_CREWRIG_E2E_HOME: "/bundle", HOME: "/h/u" },
  }),
  call("expand/no-re-expansion", EXPAND, "expand_mount", {
    args: ["${CREWRIG_E2E_HOME}/x"],
    env: { E2E_CREWRIG_E2E_HOME: "${HOME}/inner", HOME: "/h/u" },
  }),
  call("expand/unknown-token-untouched", EXPAND, "expand_mount", {
    args: ["${OTHER}/x $HOME"],
    env: { E2E_CREWRIG_E2E_HOME: "/bundle", HOME: "/h/u" },
  }),
  call("expand/missing-bundle-home", EXPAND, "expand_mount", { args: ["${CREWRIG_E2E_HOME}/x"] }),
];

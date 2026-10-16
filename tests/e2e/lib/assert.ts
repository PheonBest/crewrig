// assert.ts — TypeScript twin of tests/e2e/lib/assert.sh (spec 0261 R1, R2): the side-effect
// assertions. Twin of the shell library: change both, and keep them equal. Every function returns
// what the shell function wrote (`stderr`, the one `# FAIL` block) and its return code; a missing
// required argument is the shell's `${n:?}` abort (rc 127, message `<n>: <fn>: missing <x>`, without
// the `file: line N:` prefix of bash, which only the caller knows). Nothing reads the process
// environment or working directory: both are parameters.

import fs from "node:fs";
import path from "node:path";

import { ereMatches } from "./ere.ts";
import { findOnPath, runTool } from "./exec.ts";

export interface AssertResult {
  readonly rc: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface AssertOptions {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
}

const ELLIPSIS = "…";
export const PASS: AssertResult = { rc: 0, stdout: "", stderr: "" };

/** The shell's `${n:?fn: missing <label>}`: unset and empty are both an abort. */
export function missing(pos: number, fn: string, label: string): AssertResult {
  return { rc: 127, stdout: "", stderr: `${pos}: ${fn}: missing <${label}>\n` };
}

/** `$(...)`: drop the trailing line feeds. */
export function stripTrailingNewlines(s: string): string {
  return s.replace(/\n+$/, "");
}

/** `head -c <n>`: the first n bytes of the UTF-8 form, cut back to a character boundary. */
export function headBytes(s: string, n: number): string {
  const buf = Buffer.from(s, "utf8");
  if (buf.length <= n) return s;
  let end = n;
  while (end > 0 && ((buf[end] ?? 0) & 0xc0) === 0x80) end -= 1;
  return buf.subarray(0, end).toString("utf8");
}

/** `_e2e_truncate`: newlines to spaces, then 200 characters and an ellipsis. */
export function truncate(value: string): string {
  const s = value.split("\n").join(" ");
  const chars = Array.from(s);
  return chars.length > 200 ? `${chars.slice(0, 200).join("")}${ELLIPSIS}` : s;
}

/** `_e2e_assert_diag`: the diagnostic block of a FAIL, as the text written to stderr. */
export function assertDiag(
  name: string,
  expected: string,
  actual: string,
  artefact: string,
  env: Readonly<Record<string, string>>,
): string {
  const dir = env["E2E_REPORT_DIR"] ?? "";
  let report = "";
  if (dir !== "") report = artefact === "" ? dir : `${dir}${path.sep}${artefact}`;
  else if (artefact !== "") report = `<unset>${path.sep}${artefact}`;
  return (
    `# FAIL ${name}\n#   expected: ${truncate(expected)}\n#   actual:   ${truncate(actual)}\n` +
    (report === "" ? "" : `#   report:   ${report}\n`)
  );
}

export function fail(
  env: Readonly<Record<string, string>>,
  name: string,
  expected: string,
  actual: string,
): AssertResult {
  return { rc: 1, stdout: "", stderr: assertDiag(name, expected, actual, "", env) };
}

// ── assertions ────────────────────────────────────────────────────────────────────────────────

export function assertFileExists(p: string, o: AssertOptions): AssertResult {
  if (p === "") return missing(1, "assert_file_exists", "path");
  if (fs.existsSync(path.resolve(o.cwd, p))) return PASS;
  return fail(o.env, `assert_file_exists ${p}`, "path exists", `no such file or directory: ${p}`);
}

export function assertFileAbsent(p: string, o: AssertOptions): AssertResult {
  if (p === "") return missing(1, "assert_file_absent", "path");
  if (!fs.existsSync(path.resolve(o.cwd, p))) return PASS;
  return fail(o.env, `assert_file_absent ${p}`, "path does not exist", `path exists: ${p}`);
}

export function assertFileContains(p: string, regex: string, o: AssertOptions): AssertResult {
  if (p === "") return missing(1, "assert_file_contains", "path");
  if (regex === "") return missing(2, "assert_file_contains", "regex");
  const name = `assert_file_contains ${p} ${regex}`;
  const full = path.resolve(o.cwd, p);
  if (!fs.existsSync(full)) {
    return fail(o.env, name, "file readable + ERE match", `no such file: ${p}`);
  }
  let text = "";
  try {
    text = fs.readFileSync(full, "utf8");
  } catch {
    text = "";
  }
  if (ereMatches(regex, text)) return PASS;
  const sample = stripTrailingNewlines(headBytes(text, 400));
  return fail(o.env, name, `ERE match: ${regex}`, `no match in file (first 400 B: ${sample})`);
}

export function assertExitCode(expected: string, actual: string, o: AssertOptions): AssertResult {
  if (expected === "") return missing(1, "assert_exit_code", "expected");
  if (actual === "") return missing(2, "assert_exit_code", "actual");
  if (expected === actual) return PASS;
  return fail(o.env, `assert_exit_code ${expected} ${actual}`, expected, actual);
}

const NO_MEMPALACE =
  "mempalace binary not found — needs crewrig/e2e-mempalace image or pipx install";

/** The shared body of the two drawer probes: preflight, `mempalace search`, then `matcher` on its text. */
function drawerProbe(
  name: string,
  query: string,
  scope: readonly [string, string, number],
  want: readonly [string, string],
  matcher: string,
  o: AssertOptions,
): AssertResult {
  if (findOnPath("mempalace", o.env) === null) {
    return fail(o.env, name, "mempalace on PATH", NO_MEMPALACE);
  }
  const args = ["search", query, "--wing", scope[0], "--room", scope[1], "--results"];
  const res = runTool("mempalace", [...args, String(scope[2])], o);
  // `2>&1`: both streams land in one capture (their relative order is not preserved).
  const out = stripTrailingNewlines(res.stdout + res.stderr);
  if (res.rc !== 0) {
    return fail(o.env, name, "mempalace search exits 0", `mempalace search failed: ${out}`);
  }
  if (ereMatches(matcher, `${out}\n`)) return PASS;
  const sample = stripTrailingNewlines(headBytes(out, 200));
  return fail(o.env, name, want[0], `${want[1]}${sample}`);
}

export function assertDrawerPresent(
  wing: string,
  room: string,
  regex: string,
  o: AssertOptions,
): AssertResult {
  const fn = "assert_drawer_present";
  const gap = [wing, room, regex].findIndex((v) => v === "");
  if (gap >= 0) return missing(gap + 1, fn, ["wing", "room", "regex"][gap] as string);
  const want = [`drawer matching ERE: ${regex}`, "no match in search output: "] as const;
  return drawerProbe(`${fn} ${wing} ${room} ${regex}`, regex, [wing, room, 5], want, regex, o);
}

export function assertDrawerField(
  wing: string,
  room: string,
  handoffKey: string,
  field: string,
  expected: string,
  o: AssertOptions,
): AssertResult {
  const fn = "assert_drawer_field";
  const labels = ["wing", "room", "handoff_key", "field", "expected"];
  const gap = [wing, room, handoffKey, field, expected].findIndex((v) => v === "");
  if (gap >= 0) return missing(gap + 1, fn, labels[gap] as string);
  const want = [`${field}: ${expected}`, "no matching line in search output: "] as const;
  const name = `${fn} ${wing} ${room} ${handoffKey} ${field} ${expected}`;
  const ere = `^${field}:[[:space:]]+${expected}[[:space:]]*$`;
  return drawerProbe(name, handoffKey, [wing, room, 1], want, ere, o);
}

export function assertGitBranchPushed(
  remote: string,
  branch: string,
  o: AssertOptions,
): AssertResult {
  const fn = "assert_git_branch_pushed";
  if (remote === "") return missing(1, fn, "remote");
  if (branch === "") return missing(2, fn, "branch");
  const name = `${fn} ${remote} ${branch}`;
  if (findOnPath("git", o.env) === null)
    return fail(o.env, name, "git on PATH", "git binary not found");
  const res = runTool("git", ["ls-remote", "--exit-code", "--heads", remote, branch], o);
  if (res.rc === 0) return PASS;
  return fail(
    o.env,
    name,
    `remote ref refs/heads/${branch} present on ${remote}`,
    "git ls-remote returned non-zero (branch absent or remote unreachable)",
  );
}

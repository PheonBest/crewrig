// structural.ts — TypeScript twin of tests/e2e/lib/structural.sh (spec 0261 R1, R2): the
// structural assertions. Twin of the shell library: change both, and keep them equal.
// `assert_json_shape` ran `jq -r`; the twin spawns no jq (spec 0261 R4) and evaluates the filter
// subset the harness uses: a path made of `.`, `.name`, `."name"`, `.[N]`, `.["name"]`, with an
// optional `?`. Any other filter is refused with a clear `jq error:` diagnostic.

import fs from "node:fs";
import path from "node:path";

import {
  PASS,
  type AssertOptions,
  type AssertResult,
  assertDiag,
  ereMatches,
  fail,
  headBytes,
  missing,
  stripTrailingNewlines,
} from "./assert.ts";

export function assertStdoutMatches(
  regex: string,
  file: string,
  stdin: string,
  o: AssertOptions,
): AssertResult {
  if (regex === "") return missing(1, "assert_stdout_matches", "regex");
  const name = `assert_stdout_matches ${regex}${file === "" ? "" : ` ${file}`}`;
  let input = stdin;
  if (file !== "") {
    const full = path.resolve(o.cwd, file);
    if (!fs.existsSync(full)) return fail(o.env, name, "file exists", `no such file: ${file}`);
    input = fs.readFileSync(full, "utf8");
  }
  input = stripTrailingNewlines(input);
  if (ereMatches(regex, input)) return PASS;
  const sample = stripTrailingNewlines(headBytes(input, 200));
  return fail(o.env, name, `ERE match: ${regex}`, `no match in input: ${sample}`);
}

// ── the jq subset ─────────────────────────────────────────────────────────────────────────────

type Step = { readonly key: string | number; readonly opt: boolean };

class JqError extends Error {}

function parseFilter(filter: string): Step[] {
  const unsupported = (): never => {
    throw new JqError(`jq: error: filter not supported by the TypeScript twin: ${filter}`);
  };
  const steps: Step[] = [];
  let i = 0;
  if (filter[i] !== ".") return unsupported();
  while (i < filter.length) {
    let key: string | number | undefined;
    if (filter[i] === ".") i += 1;
    const c = filter[i];
    if (c === undefined) break;
    if (c === "[") {
      const m = /^\[\s*(-?\d+|"(?:[^"\\]|\\.)*")\s*\]/.exec(filter.slice(i));
      if (m === null) return unsupported();
      key = (m[1] as string).startsWith('"')
        ? (JSON.parse(m[1] as string) as string)
        : Number(m[1]);
      i += m[0].length;
    } else if (c === '"') {
      const m = /^"(?:[^"\\]|\\.)*"/.exec(filter.slice(i));
      if (m === null) return unsupported();
      key = JSON.parse(m[0]) as string;
      i += m[0].length;
    } else {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(filter.slice(i));
      if (m === null) return unsupported();
      key = m[0];
      i += m[0].length;
    }
    let opt = false;
    if (filter[i] === "?") {
      opt = true;
      i += 1;
    }
    steps.push({ key, opt });
    if (i < filter.length && filter[i] !== "." && filter[i] !== "[") return unsupported();
  }
  return steps;
}

const typeOf = (v: unknown): string =>
  v === null ? "null" : Array.isArray(v) ? "array" : typeof v === "object" ? "object" : typeof v;

function index(v: unknown, step: Step, file: string, text: string): unknown {
  const { key } = step;
  if (v === null) return null;
  if (typeof key === "string" && typeOf(v) === "object") {
    return Object.hasOwn(v as object, key) ? (v as Record<string, unknown>)[key] : null;
  }
  if (typeof key === "number" && Array.isArray(v)) {
    return v[key < 0 ? v.length + key : key] ?? null;
  }
  if (step.opt) return undefined;
  const lines = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  const what = typeof key === "number" ? "number" : `string "${key}"`;
  throw new JqError(
    `jq: error (at ${path.basename(file)}:${lines}): Cannot index ${typeOf(v)} with ${what}`,
  );
}

/** jq's wording for the one syntax error the harness meets: a bare word that is not a literal. */
function parseMessage(text: string, detail: string): string {
  const word = /[^\s{}[\],:"]+/g;
  for (let m = word.exec(text); m !== null; m = word.exec(text)) {
    if (/^(?:true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)$/.test(m[0])) continue;
    const end = m.index + m[0].length;
    const line = text.slice(0, end).split("\n").length;
    const col = end - (text.lastIndexOf("\n", end - 1) + 1) + 1;
    return `jq: parse error: Invalid numeric literal at line ${line}, column ${col}`;
  }
  return `jq: error: invalid JSON (wording not reproduced by the twin): ${detail}`;
}

/** `jq -r <filter> <file>`: the text jq printed on success, or the message of its failure. */
function jqRaw(filter: string, file: string, text: string): { ok: boolean; out: string } {
  try {
    const steps = parseFilter(filter);
    if (text.trim() === "") return { ok: true, out: "" };
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch (e) {
      throw new JqError(parseMessage(text, (e as Error).message));
    }
    for (const step of steps) {
      value = index(value, step, file, text);
      if (value === undefined) return { ok: true, out: "" };
    }
    return { ok: true, out: typeof value === "string" ? value : JSON.stringify(value, null, 2) };
  } catch (e) {
    if (e instanceof JqError) return { ok: false, out: e.message };
    throw e;
  }
}

export function assertJsonShape(
  file: string,
  jqPath: string,
  expected: string,
  o: AssertOptions,
): AssertResult {
  const fn = "assert_json_shape";
  if (file === "") return missing(1, fn, "file");
  if (jqPath === "") return missing(2, fn, "jq_path");
  if (expected === "") return missing(3, fn, "expected");
  const name = `${fn} ${file} ${jqPath} ${expected}`;
  const full = path.resolve(o.cwd, file);
  if (!fs.existsSync(full)) return fail(o.env, name, "file exists", `no such file: ${file}`);
  const res = jqRaw(jqPath, file, fs.readFileSync(full, "utf8"));
  if (!res.ok) {
    return fail(o.env, name, `jq -r '${jqPath}' returns successfully`, `jq error: ${res.out}`);
  }
  const actual = stripTrailingNewlines(res.out);
  return actual === expected ? PASS : fail(o.env, name, expected, actual);
}

/** `assert_gitmoji_title`: the shell's `grep -P '^\p{Emoji}[\p{Emoji_Modifier}\p{Emoji_Component}]*\s+\S'`. */
export function assertGitmojiTitle(title: string, o: AssertOptions): AssertResult {
  if (title === "") return missing(1, "assert_gitmoji_title", "string");
  const re = /^\p{Emoji}[\p{Emoji_Modifier}\p{Emoji_Component}]*\s+\S/u;
  if (title.split("\n").some((line) => re.test(line))) return PASS;
  return {
    rc: 1,
    stdout: "",
    stderr: assertDiag(
      `assert_gitmoji_title ${title}`,
      "leading emoji + whitespace + non-empty text (e.g. '✨ Add foo')",
      title,
      "",
      o.env,
    ),
  };
}

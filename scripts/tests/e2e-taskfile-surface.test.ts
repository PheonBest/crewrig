// e2e-taskfile-surface.test.ts — the e2e entries of Taskfile.yml (spec 0261 R19). Migrated from
// test-e2e-taskfile.sh, test-e2e-runner-taskfile.sh and test-e2e-auth-taskfile.sh. The static
// reads run everywhere; the `task --list` checks skip when the go-task binary is absent.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const TASKFILE = fs.readFileSync(path.join(REPO, "Taskfile.yml"), "utf8");
const TLINES = TASKFILE.split(/\r?\n/);

const declared = (entry: string): boolean =>
  TLINES.some((l) => new RegExp(`^\\s+${entry}:\\s*$`).test(l));
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `task --list` output, or null when go-task is not installed. */
const taskList = (): string | null => {
  const r = spawnSync("task", ["--list"], { cwd: REPO, encoding: "utf8" });
  if (r.error !== undefined) return null;
  return `${r.stdout}${r.stderr}`;
};
const NO_TASK = "go-task binary not on PATH";

/** The YAML block of a task key, down to the next two-space-indented task entry. */
const block = (key: string): string[] => {
  const out: string[] = [];
  let capture = false;
  for (const l of TLINES) {
    if (new RegExp(`^\\s+${esc(key)}$`).test(l)) {
      capture = true;
      out.push(l);
      continue;
    }
    if (capture && /^ {2}[a-zA-Z][a-zA-Z0-9:_-]*:$/.test(l)) capture = false;
    if (capture) out.push(l);
  }
  return out;
};

describe("e2e build and lock entries (issue #76)", () => {
  const ENTRIES = [
    "e2e:build",
    "e2e:build:base",
    "e2e:build:claude",
    "e2e:build:gemini",
    "e2e:build:copilot",
    "e2e:build:mempalace",
    "e2e:lock",
  ];
  for (const e of ENTRIES) {
    it(`declares ${e}`, () => {
      assert.ok(TLINES.some((l) => new RegExp(`^  ${esc(e)}:\\s*$`).test(l)));
    });
  }
  it("per-CLI build targets reference E2E_IMG_PREFIX and E2E_DOCKER_DIR", () => {
    const start = TLINES.findIndex((l) => /^ {2}e2e:build:base:/.test(l));
    assert.ok(start >= 0);
    const end = TLINES.findIndex((l, i) => i >= start && /^ {2}e2e:lock:/.test(l));
    const text = TLINES.slice(start, end < 0 ? undefined : end + 1).join("\n");
    assert.ok(text.includes("{{.E2E_IMG_PREFIX}}"));
    assert.ok(text.includes("{{.E2E_DOCKER_DIR}}"));
  });
  it("task --list enumerates every entry", (t) => {
    const out = taskList();
    if (out === null) return t.skip(NO_TASK);
    for (const e of ENTRIES)
      assert.match(out, new RegExp(`(^|\\s)\\* ${esc(e)}:|(^|\\s)${esc(e)}:`), e);
  });
});

describe("e2e runner entries (issue #78)", () => {
  const NAMES = ["e2e:test", "e2e:test:scenario", "e2e:test:cli"];
  for (const n of NAMES) {
    it(`declares ${n}`, () => {
      assert.ok(declared(esc(n)));
    });
  }
  it("task --list shows each with a non-empty description", (t) => {
    const out = taskList();
    if (out === null) return t.skip(NO_TASK);
    for (const n of NAMES) assert.match(out, new RegExp(`^\\* ${esc(n)}:\\s+\\S`, "m"), n);
  });
  it("references {{.CLI_ARGS}}", () => {
    assert.ok(TASKFILE.includes("{{.CLI_ARGS}}"));
  });
  it("e2e:test invokes tests/e2e/run.sh or run.ts", () => {
    const i = TLINES.findIndex((l) => /^\s+e2e:test:\s*$/.test(l));
    assert.ok(i >= 0);
    const text = TLINES.slice(i, i + 4).join("\n");
    assert.match(text, /(bash .*tests\/e2e\/run\.sh|node .*tests\/e2e\/run\.ts)/);
  });
});

describe("e2e auth entries", () => {
  const NAMES = ["e2e:auth:claude", "e2e:auth:gemini", "e2e:auth:copilot"];
  for (const n of NAMES) {
    it(`declares ${n}`, () => {
      assert.ok(declared(esc(n)));
    });
  }
  it("task --list enumerates each with a non-empty desc", (t) => {
    const out = taskList();
    if (out === null) return t.skip(NO_TASK);
    for (const n of NAMES) {
      const line = out.split(/\r?\n/).find((l) => new RegExp(`^[*\\s]*${esc(n)}:`).test(l));
      assert.ok(line !== undefined, `'${n}' not listed in: ${out}`);
      const desc = line.slice(line.indexOf(": ") + 2).trim();
      assert.notEqual(desc, "", `'${n}' desc empty`);
    }
  });
  for (const cli of ["claude", "gemini"]) {
    it(`e2e:auth:${cli} references an image precondition`, () => {
      const text = block(`e2e:auth:${cli}:`).join("\n");
      assert.match(text, new RegExp(`docker image inspect|e2e:build:${cli}`));
    });
  }
});

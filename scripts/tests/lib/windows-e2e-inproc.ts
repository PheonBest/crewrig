// windows-e2e-inproc.ts — the pure harness libraries called in-process by the Windows proof
// (spec 0261 R17, R20): TOML subset reader, command masking, probe verdict resolvers and the
// file assertions on a temp file. Platform-neutral: no shell, no interpreter.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { assertFileContains, assertFileExists } from "../../../tests/e2e/lib/assert.ts";
import { maskCommandString } from "../../../tests/e2e/lib/mask_command.ts";
import { resolveProbeA } from "../../../tests/e2e/lib/probe_a_resolve.ts";
import { resolveProbeBCell } from "../../../tests/e2e/lib/probe_b_resolve.ts";
import { resolveProbeC1 } from "../../../tests/e2e/lib/probe_c_resolve.ts";
import { parseToml } from "../../../tests/e2e/lib/toml_subset.ts";
import { guard, scratch } from "./windows-e2e-run.ts";
import type { Ctx } from "./windows-e2e-run.ts";

export function inProcess(c: Ctx): void {
  guard(c, "toml_subset parses CRLF and LF alike", () => {
    const lf = parseToml('[cli.claude]\nmounts = ["a"]\n', "lf.toml");
    const crlf = parseToml('[cli.claude]\r\nmounts = ["a"]\r\n', "crlf.toml");
    assert.deepEqual(crlf, lf);
  });
  guard(c, "mask_command masks assignments", () => {
    assert.equal(maskCommandString("TOKEN=abc run --x=1"), "TOKEN=*** run --x=***");
  });
  guard(c, "probe_a_resolve verdicts", () => {
    const lib = "probe_a_resolve.sh";
    const t = "true";
    const f = "false";
    assert.equal(
      resolveProbeA([f, f, f, f, f], lib).stdout,
      "INDETERMINATE|surface-not-read-or-session-broken\n",
    );
    assert.equal(resolveProbeA([t, f, t, t, f], lib).stdout, "BUG-ABSENT|\n");
    assert.equal(resolveProbeA([t, f, t, f, t], lib).stdout, "BUG-PRESENT|\n");
    assert.equal(resolveProbeA([t], lib).rc, 127);
  });
  guard(c, "probe_b and probe_c refuse missing arguments", () => {
    assert.equal(resolveProbeBCell([], "probe_b_resolve.sh").rc, 127);
    assert.equal(resolveProbeC1([], "probe_c_resolve.sh").rc, 127);
  });
  guard(c, "assert file assertions on a temp file", () => {
    const dir = scratch(c, "assert");
    fs.writeFileSync(path.join(dir, "a.txt"), "hello world\n");
    const o = { cwd: dir, env: {} };
    assert.equal(assertFileExists("a.txt", o).rc, 0);
    assert.equal(assertFileExists("b.txt", o).rc, 1);
    assert.equal(assertFileContains("a.txt", "^hello", o).rc, 0);
    assert.equal(assertFileContains("a.txt", "^nope", o).rc, 1);
  });
}

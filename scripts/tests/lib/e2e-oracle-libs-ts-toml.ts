// e2e-oracle-libs-ts-toml.ts — bindings of the `toml/` and `report/` library cases to their
// TypeScript twins (spec 0261 R6, R9, R10). The oracle records the shell's bytes as latin1 text, so
// a twin's UTF-8 output is handed back as the latin1 view of its bytes.

import { report } from "../../../tests/e2e/lib/report.ts";
import { tomlMerge } from "../../../tests/e2e/lib/toml_merge.ts";
import type { Binding } from "./e2e-oracle-libs-ts.ts";

const asBytes = (s: string) => Buffer.from(s, "utf8").toString("latin1");

export interface TomlDeviation {
  readonly id: string;
  /** Return code the shell recorded (yq accepted, or rejected with its own diagnostic). */
  readonly goldenRc: number;
  /** Return code of the twin, which refuses the construct (spec 0261 R6, deviation (b)). */
  readonly twinRc: number;
}

/** Negative cases the twin refuses on purpose; the differential skips them and checks both codes. */
export const EXPECTED_TOML_DEVIATIONS: readonly TomlDeviation[] = [
  { id: "toml/malformed-defaults", goldenRc: 1, twinRc: 1 },
  { id: "toml/malformed-local", goldenRc: 1, twinRc: 1 },
  { id: "toml/unsupported-date", goldenRc: 1, twinRc: 1 },
  { id: "toml/unsupported-date-in-defaults", goldenRc: 1, twinRc: 1 },
  { id: "toml/unsupported-datetime", goldenRc: 0, twinRc: 1 },
  { id: "toml/unsupported-multiline-basic-string", goldenRc: 0, twinRc: 1 },
  { id: "toml/unsupported-multiline-literal-string", goldenRc: 0, twinRc: 1 },
  { id: "toml/unsupported-inline-table", goldenRc: 0, twinRc: 1 },
  { id: "toml/unsupported-dotted-key", goldenRc: 0, twinRc: 1 },
  { id: "toml/unsupported-quoted-key", goldenRc: 0, twinRc: 1 },
  { id: "toml/unsupported-nested-array", goldenRc: 0, twinRc: 1 },
  { id: "toml/unsupported-array-of-tables", goldenRc: 0, twinRc: 1 },
];

export const bindings: Record<string, Binding> = {
  "tests/e2e/lib/toml_merge.sh": (args, ctx) => {
    const r = tomlMerge(args, ctx.work, ctx.env);
    return { rc: r.rc, stdout: asBytes(r.stdout), stderr: asBytes(r.stderr) };
  },
  "tests/e2e/lib/report.sh": (args, ctx) => {
    const r = report(args, ctx.work, new Date());
    return { rc: r.rc, stdout: asBytes(r.stdout), stderr: asBytes(r.stderr) };
  },
};

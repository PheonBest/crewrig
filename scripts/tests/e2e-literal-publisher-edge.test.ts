// e2e-literal-publisher-edge.test.ts — `scripts/e2e/publish-probe-verdict.ts --dry-run` on VALID
// verdict.json files that miss keys or carry the wrong types (spec 0261 R3), against tuples recorded
// from the real shell script (issue #1693; provenance in lib/e2e-entry-golden.ts). The shell renders
// with jq, so a missing key prints `null` and a wrong type either iterates, coerces or makes jq fail
// (status 5, jq 1.7's own message): stdout, stderr and status must match the recording byte for byte.

import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";

import type { EntryBox, EntryCase } from "./lib/e2e-entry-diff.ts";
import { ENTRY_SKIP, assertRecorded, loadGolden } from "./lib/e2e-entry-golden.ts";

const FILE = "scripts/e2e/publish-probe-verdict";
const verdict = (text: string) => (box: EntryBox) => {
  fs.mkdirSync(path.join(box.work, "rep"), { recursive: true });
  fs.writeFileSync(path.join(box.work, "rep", "verdict.json"), text);
};
const cells = (c: string, rest = "") =>
  `{"probe":"p","run_id":"r","observed_at":"t","cells":${c}${rest}}`;
const A = (cliVersion: string) =>
  `{"probe":"p","verdict":"V","cli":"c","cli_version":${cliVersion}}`;

const inputs: Record<string, string> = {
  "only-run-id": `{"run_id":"r"}`,
  "empty-object": `{}`,
  "probe-only": `{"probe":"p"}`,
  "null-doc": `null`,
  "array-doc": `[1]`,
  "array-doc-multiline": `[\n  1\n]\n`,
  "string-doc": `"s"`,
  "number-doc": `5\n`,
  "boolean-doc": `true`,
  "multiline-error": `{\n "probe": 1,\n "cells": 5\n}\n`,
  "b-no-cells": `{"probe":"p","run_id":"r","observed_at":"t","contradicts":["x"]}`,
  "cells-number": cells("5"),
  "cells-string": cells(`"abc"`),
  "cells-long-string": cells(`"${"x".repeat(40)}"`),
  "cells-multibyte-string": cells(`"${"é".repeat(20)}"`),
  "cells-null": cells("null"),
  "cells-true": cells("true"),
  "cells-object": cells(`{"b":{"cli":"b"},"a":{"cell":"c","cli":"x","outcome":"o"}}`),
  "cells-object-scalar": cells(`{"a":1}`),
  "cells-empty": cells("[]"),
  "cell-empty-object": cells("[{}]"),
  "cell-null": cells("[null]"),
  "cell-number": cells("[1]"),
  "cell-string": cells(`["s"]`),
  "cell-bool": cells("[false]"),
  "cell-array": cells("[[1]]"),
  "cell-no-cell-no-cli": cells(`[{"layout":"l","outcome":"o"}]`),
  "cell-no-cell-no-layout": cells(`[{"cli":"c","outcome":"o"}]`),
  "cell-no-cell-no-outcome": cells(`[{"cli":"c","layout":"l"}]`),
  "cell-with-cell-no-cli": cells(`[{"cell":"k","outcome":"o","reason":"r"}]`),
  "cell-with-cell-no-outcome": cells(`[{"cell":"k","cli":"c","reason":"r"}]`),
  "cell-with-cell-no-reason": cells(`[{"cell":"k","cli":"c","outcome":"o"}]`),
  "cell-reason-false": cells(`[{"cell":"k","cli":"c","outcome":"o","reason":false}]`),
  "cell-reason-zero": cells(`[{"cell":"k","cli":"c","outcome":"o","reason":0}]`),
  "cell-reason-object": cells(`[{"cell":"k","cli":"c","outcome":"o","reason":{"a":[1]}}]`),
  "cell-null-cell": cells(`[{"cell":null,"cli":1,"outcome":true}]`),
  "cell-typed-values": cells(`[{"cell":2,"cli":[1,"a"],"outcome":{"k":null}}]`),
  "contradicts-missing": cells("[]"),
  "contradicts-null": cells("[]", `,"contradicts":null`),
  "contradicts-false": cells("[]", `,"contradicts":false`),
  "contradicts-true": cells("[]", `,"contradicts":true`),
  "contradicts-empty-array": cells("[]", `,"contradicts":[]`),
  "contradicts-empty-string": cells("[]", `,"contradicts":""`),
  "contradicts-string": cells("[]", `,"contradicts":"ab"`),
  "contradicts-zero": cells("[]", `,"contradicts":0`),
  "contradicts-number": cells("[]", `,"contradicts":5`),
  "contradicts-negative": cells("[]", `,"contradicts":-3`),
  "contradicts-object": cells("[]", `,"contradicts":{"a":1,"b":"x"}`),
  "contradicts-empty-object": cells("[]", `,"contradicts":{}`),
  "contradicts-mixed": cells("[]", `,"contradicts":[1,null,{"a":1},"s",[2]]`),
  "a-cli-version-number": A("3"),
  "a-cli-version-float": A("2.5"),
  "a-cli-version-true": A("true"),
  "a-cli-version-null": A("null"),
  "a-cli-version-missing": `{"probe":"p","verdict":"V","cli":"c"}`,
  "a-cli-version-array": A(`[1,"a"]`),
  "a-cli-version-object": A(`{"a":{"b":1}}`),
  "a-verdict-only": `{"verdict":"V"}`,
  "a-verdict-null": `{"verdict":null}`,
  "a-verdict-object": `{"verdict":{"a":1}}`,
  "a-both-shapes": `{"verdict":"V","cells":[{"cli":"x","layout":"l","outcome":"o"}]}`,
  "run-id-trailing-newlines": `{"run_id":"r\\n\\n","probe":"p\\n","observed_at":["a"]}`,
};

const golden = loadGolden("publisher-edge");

describe(
  "publish-probe-verdict.ts edge verdicts: recorded shell tuples",
  { skip: ENTRY_SKIP },
  () => {
    for (const [name, text] of Object.entries(inputs)) {
      const c: EntryCase = {
        id: `pub-edge/${name}`,
        file: FILE,
        args: ["rep", "--issue", "1103", "--dry-run"],
        seed: verdict(text),
      };
      it(c.id, () => assertRecorded(c, golden));
    }
  },
);

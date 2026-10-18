// mempalace-pin-read.test.ts — groups G1 and G2 of the retired
// scripts/tests/test-mempalace-pin.sh (spec 0263, PR E): the Python read_pin against the
// real mempalace-pin.json and against fixtures derived from it by text transform.
// G1's print-pin leg duplicates one assertion of mempalace-pin.test.ts ("the real
// pin file agrees...") on purpose: the oracle here is an independent JSON parse.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import {
  PIN_FILE,
  PIN_MODULE,
  type Rig,
  makeRig,
  printPin,
  readPin,
} from "./lib/mempalace-pin-rig.ts";

let rig: Rig;
before(() => {
  rig = makeRig();
});
after(() => rig.cleanup());

describe("G1 read_pin against the repository's real pin file", () => {
  test("--print-pin returns the pin declared in mempalace-pin.json", () => {
    const pin = readPin();
    const res = printPin(rig, PIN_FILE);
    assert.equal(res.rc, 0, res.out);
    assert.equal(res.out, `min=${pin.min} max=${pin.max}`);
  });

  test("mempalace_pin.py carries neither bound as a bare substring (R5)", () => {
    const pin = readPin();
    const lines = fs.readFileSync(PIN_MODULE, "utf8").split("\n");
    for (const bound of [pin.min, pin.max]) {
      const hits = lines.filter((line) => line.includes(bound));
      assert.deepEqual(hits, [], `bound literal '${bound}' present in ${PIN_MODULE}`);
    }
  });
});

/** A fixture pin file derived from the real one, so no pin literal is authored here. */
function derive(name: string, transform: (text: string) => string): string {
  const file = path.join(rig.root, `${name}.json`);
  fs.writeFileSync(file, transform(fs.readFileSync(PIN_FILE, "utf8")));
  return file;
}

const MIN_LINE = /^\s*"min":.*$/m;

const REFUSALS: ReadonlyArray<readonly [string, (text: string) => string]> = [
  ["min key deleted", (t) => t.replace(/^\s*"min":.*\n/m, "")],
  [
    "maxExclusive key deleted",
    (t) => t.replace(/^\s*"maxExclusive":.*\n/m, "").replace(/,(\s*})/, "$1"),
  ],
  ["min is not a string", (t) => t.replace(MIN_LINE, '  "min": 3.6,')],
  ["min is empty", (t) => t.replace(MIN_LINE, '  "min": "",')],
  ["not an object", () => '["3.6.0", "3.7"]\n'],
  ["not JSON", () => "MEMPALACE_MIN_VERSION=3.6.0\n"],
];

describe("G2 read_pin's declaration contract", () => {
  for (const [label, transform] of REFUSALS) {
    test(`${label}: refused with a PIN_ERROR diagnostic`, () => {
      const fixture = derive(label.replace(/\W+/g, "-"), transform);
      assert.notEqual(fs.readFileSync(fixture, "utf8"), fs.readFileSync(PIN_FILE, "utf8"));
      const res = printPin(rig, fixture);
      assert.notEqual(res.rc, 0, `accepted a malformed pin ('${res.out}')`);
      assert.ok(res.out.startsWith("PIN_ERROR"), res.out);
    });
  }

  test("absent pin file: refused with a PIN_ERROR diagnostic", () => {
    const res = printPin(rig, path.join(rig.root, "does-not-exist.json"));
    assert.notEqual(res.rc, 0, res.out);
    assert.ok(res.out.startsWith("PIN_ERROR"), res.out);
  });
});

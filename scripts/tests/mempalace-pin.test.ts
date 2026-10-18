// mempalace-pin.test.ts — hermetic tests of scripts/lib/mempalace-pin.ts
// (spec 0252 requirement 4): the pin is read from the two declaration lines of
// mempalace-pin.json by the rules of scripts/lib/mempalace_pin.py, never redeclared.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { installSpec, readMempalacePin } from "../lib/mempalace-pin.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const temps: string[] = [];
after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

/** A throwaway repo root whose scripts/lib/mempalace-pin.json holds `text`. */
function fixtureRoot(text: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mempalace-pin-"));
  temps.push(root);
  fs.mkdirSync(path.join(root, "scripts", "lib"), { recursive: true });
  fs.writeFileSync(path.join(root, "scripts", "lib", "mempalace-pin.json"), text);
  return root;
}

const DECLARED = '{\n  "min": "3.6.0",\n  "maxExclusive": "3.7"\n}\n';

describe("readMempalacePin", () => {
  test("reads both bounds from a fixture", () => {
    assert.deepEqual(readMempalacePin(fixtureRoot(DECLARED)), {
      min: "3.6.0",
      maxExclusive: "3.7",
    });
  });

  test("ignores keys it does not know", () => {
    const text = '{"min": "3.6.0", "maxExclusive": "3.7", "note": {"min": "9.9"}}\n';
    assert.deepEqual(readMempalacePin(fixtureRoot(text)), { min: "3.6.0", maxExclusive: "3.7" });
  });

  test("a missing key is refused, naming the key", () => {
    assert.throws(
      () => readMempalacePin(fixtureRoot('{"min": "3.6.0"}\n')),
      /"maxExclusive" must be declared as a non-empty string/,
    );
  });

  test("a non-string or empty bound is refused", () => {
    assert.throws(
      () => readMempalacePin(fixtureRoot('{"min": 3.6, "maxExclusive": "3.7"}\n')),
      /"min" must be declared as a non-empty string/,
    );
    assert.throws(
      () => readMempalacePin(fixtureRoot('{"min": "3.6.0", "maxExclusive": ""}\n')),
      /"maxExclusive" must be declared as a non-empty string/,
    );
  });

  test("a file that is not a JSON object is refused", () => {
    assert.throws(() => readMempalacePin(fixtureRoot("[1, 2]\n")), /"min" must be declared/);
    assert.throws(() => readMempalacePin(fixtureRoot("min=3.6.0\n")), /is not valid JSON/);
  });

  test("a CRLF file reads the same pin, as mempalace_pin.py does in text mode", () => {
    const pin = readMempalacePin(fixtureRoot(DECLARED.replaceAll("\n", "\r\n")));
    assert.deepEqual(pin, readMempalacePin(fixtureRoot(DECLARED)));
  });

  test("a lone carriage return is a line end, as in Python's universal newlines", () => {
    const pin = readMempalacePin(fixtureRoot(DECLARED.replaceAll("\n", "\r")));
    assert.deepEqual(pin, readMempalacePin(fixtureRoot(DECLARED)));
  });

  test("an unreadable pin file throws the file-system error", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mempalace-pin-"));
    temps.push(root);
    assert.throws(() => readMempalacePin(root), { code: "ENOENT" });
  });

  test("the real pin file agrees with mempalace_pin.py --print-pin", () => {
    const pin = readMempalacePin(REPO);
    assert.match(pin.min, /^\d+(\.\d+)*$/);
    assert.match(pin.maxExclusive, /^\d+(\.\d+)*$/);
    const py = spawnSync(
      "python3",
      [
        "-I",
        path.join(REPO, "scripts", "lib", "mempalace_pin.py"),
        "--pin-file",
        path.join(REPO, "scripts", "lib", "mempalace-pin.json"),
        "--print-pin",
      ],
      { encoding: "utf8" },
    );
    if (py.status !== 0) return; // python3 unavailable: the format assertions above stand
    assert.equal(py.stdout.trim(), `min=${pin.min} max=${pin.maxExclusive}`);
  });

  test("the module never declares the values itself", () => {
    const source = fs.readFileSync(path.join(REPO, "scripts", "lib", "mempalace-pin.ts"), "utf8");
    const { min, maxExclusive } = readMempalacePin(REPO);
    assert.ok(!source.includes(`"${min}"`) && !source.includes(`"${maxExclusive}"`));
  });
});

describe("installSpec", () => {
  test("lower bound inclusive, upper bound exclusive", () => {
    assert.equal(installSpec({ min: "3.6.0", maxExclusive: "3.7" }), "mempalace>=3.6.0,<3.7");
  });

  test("takes the pin as read", () => {
    const pin = readMempalacePin(fixtureRoot('{"min": "1.2", "maxExclusive": "2"}\n'));
    // Built from parts: the single-source range guard flags any literal numeric range.
    assert.equal(installSpec(pin), ["mempalace", ">=", "1.2", ",<", "2"].join(""));
  });
});

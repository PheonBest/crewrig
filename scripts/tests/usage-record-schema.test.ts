// usage-record-schema.test.ts — TypeScript port of test-usage-record-schema.sh (spec 0260,
// row J1a). Three directory sweeps over scripts/lib/usage-record-validator.js: samples must
// validate, mutants must be rejected BY THE SCHEMA, the derivation fixture must fail ONLY
// the recordId derivation (spec 0205 R17/R18/R22). Runs on every platform: no POSIX tool.
//
// VERIFY resolved: the validator locates the schema through `__dirname/../../schemas/...`,
// so the mutation cases copy the validator AND the schema into one temp tree (copyTracked)
// and run the copy; node_modules is linked in for ajv. Tracked files are never edited.
// The literal U+001F in the validator's UNIT_SEPARATOR is never rewritten by a needle.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { requireOrSkip } from "./lib/capability.ts";
import { applyMutation, copyTracked } from "./lib/mutation-copy.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const VALIDATOR_REL = "scripts/lib/usage-record-validator.js";
const SAMPLES = path.join(REPO, "schemas", "usage-record", "samples");
const FIXTURES = path.join(REPO, "scripts", "tests", "fixtures", "usage-records");
const MUTANTS = path.join(FIXTURES, "mutants");
const DERIVATION = path.join(FIXTURES, "derivation");

function jsonFiles(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .sort()
    .map((n) => path.join(dir, n));
}

/** Run the validator under `root` on `file`; output is stdout+stderr merged (Bash used 2>&1). */
function validate(root: string, file: string): { status: number | null; out: string } {
  const env = { ...process.env };
  delete env.CI;
  const r = spawnSync(process.execPath, [path.join(root, VALIDATOR_REL), file], {
    encoding: "utf8",
    env,
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

// Each checker returns null when the contract holds, else a short failure description.
function sampleFailure(root: string, file: string): string | null {
  const { status, out } = validate(root, file);
  return status === 0 && out.includes(": OK") ? null : `exit ${status}: ${out}`;
}
function mutantFailure(root: string, file: string): string | null {
  const { status, out } = validate(root, file);
  return status === 1 && out.includes(": schema ") ? null : `exit ${status}: ${out}`;
}
function tokensFailure(root: string, file: string): string | null {
  const { status, out } = validate(root, file);
  return status === 1 && out.includes(": schema ") && out.includes("tokens")
    ? null
    : `exit ${status}: ${out}`;
}
function derivationFailure(root: string, file: string): string | null {
  const { status, out } = validate(root, file);
  return status === 1 && out.includes("recordId mismatch") && !out.includes(": schema ")
    ? null
    : `exit ${status}: ${out}`;
}

const mutantFile = (name: string) => path.join(MUTANTS, name);

describe("preflight", () => {
  test("ajv is installed", () => {
    // Bash exit 2 FATAL: a missing dependency must never turn into a silent pass.
    assert.ok(
      fs.existsSync(path.join(REPO, "node_modules", "ajv")),
      "node_modules/ajv is missing: run npm install",
    );
  });
});

describe("schemas/usage-record/samples/*.json validate", () => {
  test("samples dir is non-empty", () => {
    assert.ok(jsonFiles(SAMPLES).length > 0, `samples directory has zero files (${SAMPLES})`);
  });
  for (const file of jsonFiles(SAMPLES)) {
    test(`samples/${path.basename(file)} validates`, () => {
      assert.equal(sampleFailure(REPO, file), null);
    });
  }
});

describe("mutants/*.json are rejected by the schema", () => {
  test("mutants dir is non-empty", () => {
    assert.ok(jsonFiles(MUTANTS).length > 0, `mutants directory has zero files (${MUTANTS})`);
  });
  for (const file of jsonFiles(MUTANTS)) {
    test(`mutants/${path.basename(file)} rejected by schema`, () => {
      assert.equal(mutantFailure(REPO, file), null);
    });
  }
  test("zero-for-unread names tokens", () => {
    // PLAN v3-F1 remediation 2: rejected by the all-zero tokens block, not an incidental field.
    assert.equal(tokensFailure(REPO, mutantFile("zero-for-unread.json")), null);
  });
});

describe("derivation/*.json fail only recordId derivation", () => {
  test("derivation dir is non-empty", () => {
    assert.ok(
      jsonFiles(DERIVATION).length > 0,
      `derivation directory has zero files (${DERIVATION})`,
    );
  });
  for (const file of jsonFiles(DERIVATION)) {
    test(`recordId mismatch is not a schema failure (${path.basename(file)})`, () => {
      assert.equal(derivationFailure(REPO, file), null);
    });
  }
});

describe("proof mutants (temp copy of validator + schema)", () => {
  function withMutation(
    t: Parameters<typeof requireOrSkip>[0],
    file: string,
    needle: string | RegExp,
    replacement: string,
    fn: (root: string) => void,
  ): void {
    if (
      !requireOrSkip(
        t,
        fs.existsSync(path.join(REPO, "node_modules", "ajv")),
        "ajv is not installed",
      )
    )
      return;
    const copy = copyTracked(REPO, [VALIDATOR_REL, "schemas/usage-record"], {
      linkNodeModules: true,
    });
    try {
      applyMutation(copy, file, needle, replacement);
      fn(copy.root);
    } finally {
      copy.dispose();
    }
  }
  const SCHEMA_REL = "schemas/usage-record/v1.schema.json";

  test("unmutated copy is green (the copy mechanism itself is sound)", (t) => {
    if (
      !requireOrSkip(
        t,
        fs.existsSync(path.join(REPO, "node_modules", "ajv")),
        "ajv is not installed",
      )
    )
      return;
    const copy = copyTracked(REPO, [VALIDATOR_REL, "schemas/usage-record"], {
      linkNodeModules: true,
    });
    try {
      assert.equal(mutantFailure(copy.root, mutantFile("price-present.json")), null);
      assert.equal(derivationFailure(copy.root, jsonFiles(DERIVATION)[0] as string), null);
    } finally {
      copy.dispose();
    }
  });

  test("allowing additional root properties turns price-present red", (t) => {
    withMutation(
      t,
      SCHEMA_REL,
      /"additionalProperties": false,(\s*"allOf")/,
      '"additionalProperties": true,$1',
      (root) => {
        assert.notEqual(mutantFailure(root, mutantFile("price-present.json")), null);
      },
    );
  });

  test("loosening the all-zero tokens rule turns zero-for-unread red", (t) => {
    withMutation(
      t,
      SCHEMA_REL,
      /("required": \["modelId", "interaction", "tokens", "rawStatus"\],\s*"anyOf": \[)/,
      "$1 true,",
      (root) => {
        assert.notEqual(tokensFailure(root, mutantFile("zero-for-unread.json")), null);
      },
    );
  });

  test("deleting the recordId derivation check turns recordid-mismatch red", (t) => {
    withMutation(t, VALIDATOR_REL, "if (found !== expected) {", "if (false) {", (root) => {
      assert.notEqual(derivationFailure(root, jsonFiles(DERIVATION)[0] as string), null);
    });
  });

  test("reporting mismatch instead of schema errors turns every mutant red", (t) => {
    withMutation(
      t,
      VALIDATOR_REL,
      "${file}: schema ${error.instancePath",
      "${file}: recordId mismatch ${error.instancePath",
      (root) => {
        for (const file of jsonFiles(MUTANTS)) {
          assert.notEqual(mutantFailure(root, file), null, path.basename(file));
        }
      },
    );
  });
});

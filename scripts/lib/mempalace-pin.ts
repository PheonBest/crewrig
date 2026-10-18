// mempalace-pin.ts — read the MemPalace supported-range pin (spec 0252
// requirement 4, delta-01).
//
// The TypeScript counterpart of the pin reader in scripts/lib/mempalace_pin.py
// (`read_pin`): the pin is the JSON object
//
//     {"min": "<version>", "maxExclusive": "<version>"}
//
// of scripts/lib/mempalace-pin.json, the single declaration (spec 0266 moved it
// out of scripts/lib/common.sh). This module SHALL NOT declare either value a
// second time: it reads them, by the same rules as `read_pin` - both bounds must
// be non-empty strings of one JSON object; anything else is a refusal, never a
// guess. No shell is spawned to obtain the values.
//
// Standard library only (spec 0240 R16).

import fs from "node:fs";
import path from "node:path";

/** The MemPalace supported range `[min, maxExclusive)`. */
export interface MempalacePin {
  readonly min: string;
  readonly maxExclusive: string;
}

/** Where the pin is declared, relative to the repository root. */
const PIN_FILE = ["scripts", "lib", "mempalace-pin.json"] as const;

/**
 * Read the pin from `<repoRoot>/scripts/lib/mempalace-pin.json`.
 *
 * Throws the file-system error when the file cannot be read, and an `Error`
 * naming the offending key when the file is not a JSON object or a bound is
 * absent or not a non-empty string.
 */
export function readMempalacePin(repoRoot: string): MempalacePin {
  const file = path.join(repoRoot, ...PIN_FILE);
  const text: unknown = fs.readFileSync(file, "utf8");
  if (typeof text !== "string") throw new Error(`${file} did not read as text`);
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${error instanceof Error ? error.message : ""}`);
  }
  return { min: bound(doc, "min", file), maxExclusive: bound(doc, "maxExclusive", file) };
}

function bound(doc: unknown, key: string, file: string): string {
  const value: unknown =
    typeof doc === "object" && doc !== null && !Array.isArray(doc)
      ? (doc as Record<string, unknown>)[key]
      : undefined;
  if (typeof value !== "string" || value === "") {
    throw new Error(`"${key}" must be declared as a non-empty string in the JSON object ${file}`);
  }
  return value;
}

/**
 * The pip requirement for the pinned range, the text `offer_mempalace_install`
 * of the setup hands to `pipx install` (`mempalace>=3.6.0,<3.7` for a pin of
 * 3.6.0 and 3.7): the lower bound inclusive, the upper bound exclusive.
 */
export function installSpec(pin: MempalacePin): string {
  return `mempalace>=${pin.min},<${pin.maxExclusive}`;
}

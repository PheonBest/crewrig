// shell-extension-harness.ts — the recorded outputs of the retired extension hooks shell library, for
// the conformance suite of its TypeScript twin (spec 0254 R22; the shell is gone, spec 0266). The manifest
// library (extension-manifest.sh) is retired too: its legs are frozen goldens (see manifestGolden below).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { frozen } from "./component-resolve-golden.ts";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const LIB_DIR = path.join(REPO, "scripts", "lib");
export const PERCLI_KEYS_FILE = path.join(LIB_DIR, "extension-percli-keys.json");

/** Non-empty when the replay cannot run here: Windows. */
export const skipReason: string =
  process.platform === "win32"
    ? "skipped: the recorded outputs key paths with POSIX separators"
    : "";

/** What one manifest produced: every output file of its case directory, by relative path. */
export type CaseOutput = Readonly<Record<string, string>>;

/**
 * The outputs of the retired hooks library for one manifest, REPLAYED from
 * fixtures/component-resolve-oracle/extension-hooks.json.golden by the fixture label (the manifest's
 * directory reads `<DIR>`); only the Linux golden container (COMPONENT_RESOLVE_GOLDEN_REGEN=1) ran the shell.
 */
export function runShellCases(
  cases: readonly { readonly label: string; readonly file: string }[],
): CaseOutput[] {
  return cases.map((c) =>
    frozen<CaseOutput>(
      "extension-hooks",
      c.label,
      { "<DIR>": path.dirname(c.file), "<REPO>": REPO },
      () => {
        throw new Error(
          "the shell libraries are removed (spec 0266): the goldens can no longer be recorded here",
        );
      },
    ),
  );
}

/** What the retired `extension-manifest.sh` produced for one fixture, recorded on Linux. */
export interface ManifestGolden {
  /** `VALIDATION-ERROR:` lines of `ext_validate_manifest`; the manifest path reads `<M>`. */
  readonly validate: readonly string[];
  /** `ext_mcp_delivery <target>` stdout, trimmed. */
  readonly delivery: Readonly<Record<string, string>>;
  /** `ext_mcp_native <target> <manifest>`: stdout without its final newline, and the status. */
  readonly native: Readonly<Record<string, { readonly out: string; readonly status: number }>>;
}

const GOLDENS = path.join(REPO, "scripts", "tests", "fixtures", "extension-manifest-goldens");

/** The frozen shell expectations of the manifest library, keyed by fixture label. */
export function manifestGoldens(): Readonly<Record<string, ManifestGolden>> {
  const read = (name: string): Record<string, unknown> =>
    JSON.parse(fs.readFileSync(path.join(GOLDENS, `${name}.json.golden`), "utf8")) as Record<
      string,
      unknown
    >;
  const validate = read("validate");
  const delivery = read("mcp-delivery");
  const native = read("mcp-native");
  return Object.fromEntries(
    Object.keys(validate).map((label) => [
      label,
      { validate: validate[label], delivery: delivery[label], native: native[label] },
    ]),
  ) as Record<string, ManifestGolden>;
}

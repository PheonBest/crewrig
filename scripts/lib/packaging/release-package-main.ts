// release-package-main.ts — argument handling of `release-package-extension` (spec 0257 R9).
// Replaced the argument handling of the former scripts/release-package-extension.sh (:51-79): `<name> --version <v> --out <dir>`, the
// flags in any order, `--version` and `--out` taking a non-empty value (the shell's `${2:?...}`).

import { repoDirOf } from "../extension/entry-ctx.ts";
import type { EntryInput } from "../extension/entry-ctx.ts";
import { releasePackage } from "./release-package.ts";

const USAGE = "Usage: release-package-extension.sh <name> --version <v> --out <dir>";

type Parsed =
  | { readonly ok: true; readonly name: string; readonly version: string; readonly outDir: string }
  | { readonly ok: false; readonly message: string };

function parse(argv: readonly string[]): Parsed {
  let name = "";
  let version = "";
  let outDir = "";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--version" || arg === "--out") {
      const value = argv[i + 1] ?? "";
      if (value === "") return { ok: false, message: USAGE };
      if (arg === "--version") version = value;
      else outDir = value;
      i++;
    } else if (name === "") {
      name = arg;
    } else {
      return { ok: false, message: `Error: unexpected argument '${arg}'` };
    }
  }
  if (name === "" || version === "" || outDir === "") return { ok: false, message: USAGE };
  return { ok: true, name, version, outDir };
}

/** Run `release-package-extension`; returns its exit status. */
export async function main(input: EntryInput): Promise<number> {
  const parsed = parse(input.argv);
  if (!parsed.ok) {
    input.io.err(parsed.message);
    return 1;
  }
  return await releasePackage({
    repoDir: repoDirOf(input.entryFile),
    name: parsed.name,
    version: parsed.version,
    outDir: parsed.outDir,
    env: input.env,
    platform: input.platform,
    io: input.io,
  });
}

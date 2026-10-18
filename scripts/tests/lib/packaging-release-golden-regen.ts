// packaging-release-golden-regen.ts — regenerate scripts/tests/fixtures/packaging-release/ from the
// TypeScript leg (spec 0257 R25). The committed goldens were generated from the original shell
// scripts at 8ea59836 (the parent of the switch pull request, origin/release/1231-ts-migration),
// before those scripts became shims of the TypeScript entries. After the switch there is no
// shell oracle left to generate from: a regeneration records what the TypeScript entries do now,
// so it needs a reviewed diff of the stored files it prints. Run it in a Linux container, never on
// a macOS host for committed goldens (bsdtar and GNU tar differ in what they archive):
//
//   PACKAGING_GOLDEN_REGEN=1 node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
//     scripts/tests/lib/packaging-release-golden-regen.ts
//
// The command prints the stored files that changed.

import { CASES } from "./packaging-release-differential.ts";
import { compareGolden, goldenFiles, readGolden, writeGolden } from "./packaging-release-golden.ts";
import { observe } from "./packaging-release-observe.ts";

function main(): number {
  if (process.env.PACKAGING_GOLDEN_REGEN !== "1") {
    process.stderr.write("Error: set PACKAGING_GOLDEN_REGEN=1 to regenerate the goldens.\n");
    return 1;
  }
  const changed: string[] = [];
  for (const testCase of CASES) {
    const files = goldenFiles(observe("ts", testCase));
    for (const line of compareGolden(files, readGolden(testCase.name)))
      changed.push(`${testCase.name}/${line.split(":")[0] ?? ""}`);
    writeGolden(testCase.name, files);
  }
  process.stdout.write(changed.length === 0 ? "golden unchanged\n" : `${changed.join("\n")}\n`);
  return 0;
}

process.exitCode = main();

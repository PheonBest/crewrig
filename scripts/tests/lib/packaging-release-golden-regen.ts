// packaging-release-golden-regen.ts — regenerate scripts/tests/fixtures/packaging-release/ from the
// SHELL leg (spec 0257 R25). Run it in a Linux container, never on a macOS host for committed
// goldens (bsdtar and GNU tar differ in what they archive):
//
//   PACKAGING_GOLDEN_REGEN=1 node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
//     scripts/tests/lib/packaging-release-golden-regen.ts
//
// A difference that a tagged deviation rule covers is pinned to the TypeScript value; an untagged
// one aborts the run. Cases without a shell oracle (release-sync-manifests) are stored from the
// TypeScript leg and need a reviewed diff. The command prints the stored files that changed.

import { CASES } from "./packaging-release-differential.ts";
import { findDifferences, tagOf } from "./packaging-release-deviations.ts";
import {
  compareGolden,
  goldenFiles,
  pinTs,
  readGolden,
  writeGolden,
} from "./packaging-release-golden.ts";
import { HAS_SHELL_TOOLS, observe } from "./packaging-release-observe.ts";

function main(): number {
  if (process.env.PACKAGING_GOLDEN_REGEN !== "1") {
    process.stderr.write("Error: set PACKAGING_GOLDEN_REGEN=1 to regenerate the goldens.\n");
    return 1;
  }
  if (!HAS_SHELL_TOOLS) {
    process.stderr.write("Error: regeneration needs bash, jq and tar on a POSIX host.\n");
    return 1;
  }
  const changed: string[] = [];
  for (const testCase of CASES) {
    const ts = observe("ts", testCase);
    let source = ts;
    if (testCase.oracle !== false) {
      const shell = observe("shell", testCase);
      const diffs = findDifferences(shell, ts);
      const untagged = diffs.filter((d) => tagOf(d) === undefined);
      if (untagged.length > 0) {
        process.stderr.write(
          `Error: ${testCase.name}: untagged difference(s): ${untagged.map((d) => d.field).join(", ")}\n`,
        );
        return 1;
      }
      source = pinTs(shell, ts, diffs);
    }
    const files = goldenFiles(source);
    for (const line of compareGolden(files, readGolden(testCase.name)))
      changed.push(`${testCase.name}/${line.split(":")[0] ?? ""}`);
    writeGolden(testCase.name, files);
  }
  process.stdout.write(changed.length === 0 ? "golden unchanged\n" : `${changed.join("\n")}\n`);
  return 0;
}

process.exitCode = main();

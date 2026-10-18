// harness-curator-golden-regen.ts — regenerate scripts/tests/fixtures/harness-curator/ from the
// TypeScript entries (the `.sh` shims are gone: spec 0266, J4 S3b). Every stored case is the entry
// observation; no overlay is written. Never run it on a macOS host for committed goldens. It runs in
// a Linux container that mirrors the CI runner (Ubuntu 24.04, Bash 5.2, jq 1.7, Node.js 24, python3,
// GNU tar and gzip): Node at /usr/local/bin/node in the first image, under
// /opt/hostedtoolcache/node/<v>/x64/bin in the second (normalised to `<NODE>`). The worktree's
// `.git` is a pointer file to a host path, so mount the worktree read-only, copy it inside the
// container and re-initialise git there. Run each image into its own output directory, then
// `diff -r` the two `scripts/tests/fixtures/harness-curator/` trees: it MUST be empty before the
// goldens are committed.
//
//   docker run --rm --name j4-s3b-1 -v "$PWD":/src:ro -v "$OUT1":/out <image> \
//     sh -c 'cp -a /src /w && cd /w && rm -f .git && git init -q && \
//       HC_GOLDEN_REGEN=1 node scripts/tests/lib/harness-curator-golden-regen.ts && \
//       cp -a scripts/tests/fixtures/harness-curator /out/'
//
// Optional argument: one case name.

import { CASES } from "./harness-curator-cases.ts";
import { caseDir, goldenFiles, writeGolden } from "./harness-curator-differential.ts";
import { observe } from "./harness-curator-observe.ts";

function main(): number {
  if (process.env["HC_GOLDEN_REGEN"] !== "1") {
    process.stderr.write("Error: set HC_GOLDEN_REGEN=1 to regenerate the goldens.\n");
    return 1;
  }
  if (process.platform !== "linux") {
    process.stderr.write("Error: run in the Linux golden container, never on a host.\n");
    return 1;
  }
  const only = process.argv[2];
  for (const testCase of CASES) {
    if (only !== undefined && only !== testCase.name) continue;
    writeGolden(testCase.name, goldenFiles(observe(testCase, "entry")));
    process.stdout.write(`${caseDir(testCase.name)}\n`);
  }
  return 0;
}

process.exitCode = main();

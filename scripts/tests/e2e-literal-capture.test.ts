// e2e-literal-capture.test.ts — `scripts/e2e-capture-versions.ts` against tuples recorded from the
// real shell script (issue #1693; provenance in lib/e2e-entry-golden.ts). The Docker stand-in answers
// each `docker run` with the next fixture; the lockfile text, streams, status and every Docker call
// are compared with the literal recording. The shell never exits 2 (its empty-field list is filled in
// a subshell), so the `<unknown>` cases below record status 0.

import { describe, it } from "node:test";

import type { FixtureEntry } from "./lib/e2e-docker-standin.ts";
import type { EntryCase } from "./lib/e2e-entry-diff.ts";
import { ENTRY_SKIP, assertRecorded, loadGolden } from "./lib/e2e-entry-golden.ts";

const CAPTURE = "scripts/e2e-capture-versions";

const versions = [
  "12.5\n",
  "v22.1.0\n",
  "10.7.0\n",
  "Python 3.12.3\r\nextra\n",
  "pipx 1.4\n",
  "gh version 2.40\n",
  "yq v4\n",
  "jq-1.7\n",
  "0.3.1\n",
  "2.0.1\n",
  "0.9.0\n",
  "copilot 1.2\n",
  "mempalace 3.6\n",
].map((stdout): FixtureEntry => ({ stdout }));

function withEmpty(indexes: number[]): FixtureEntry[] {
  return versions.map((e, i) => (indexes.includes(i) ? { stdout: "" } : e));
}

const cases: EntryCase[] = [
  { id: "capture/ok", file: CAPTURE, args: ["pre/e2e", "out/lock.txt"], fixtures: versions },
  { id: "capture/defaults", file: CAPTURE, fixtures: versions },
  { id: "capture/empty-prefix", file: CAPTURE, args: ["", ""], fixtures: versions },
  { id: "capture/nested-lock", file: CAPTURE, args: ["p", "a/b/c.lock"], fixtures: versions },
  { id: "capture/unknown-one", file: CAPTURE, args: ["p", "l"], fixtures: withEmpty([5]) },
  { id: "capture/unknown-many", file: CAPTURE, args: ["p", "l"], fixtures: withEmpty([0, 9, 12]) },
  {
    id: "capture/run-fails",
    file: CAPTURE,
    args: ["p", "l"],
    fixtures: [{ exit: 3, stdout: "x\n" }, ...versions.slice(1)],
  },
  {
    id: "capture/missing-one",
    file: CAPTURE,
    args: ["p", "l"],
    missingImages: ["p-gemini:latest"],
    forbidRun: true,
  },
  {
    id: "capture/missing-all",
    file: CAPTURE,
    args: ["p", "l"],
    missingImages: [
      "p-base:latest",
      "p-claude:latest",
      "p-gemini:latest",
      "p-copilot:latest",
      "p-mempalace:latest",
    ],
    forbidRun: true,
  },
];

const golden = loadGolden("capture");

describe("e2e-capture-versions.ts: recorded shell tuples", { skip: ENTRY_SKIP }, () => {
  for (const c of cases) it(c.id, () => assertRecorded(c, golden));
});

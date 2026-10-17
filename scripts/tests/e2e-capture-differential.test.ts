// e2e-capture-differential.test.ts — test-gemini-headless.sh against its TypeScript twin (spec 0261
// R10): same rc, streams, files, Docker calls. The e2e-capture-versions.sh shim is removed.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { FixtureEntry } from "./lib/e2e-docker-standin.ts";
import {
  runEntry,
  shellLegPrerequisites,
  type EntryBox,
  type EntryCase,
  type EntryTuple,
} from "./lib/e2e-entry-diff.ts";
import { REPO_ROOT } from "./lib/e2e-normalise.ts";
import { shellLegSkipReason } from "./lib/e2e-shim.ts";
import fs from "node:fs";
import path from "node:path";

/** macOS mktemp ignores TMPDIR, GNU mktemp honours it: only the parent of `tmp.<RAND>` differs. */
function workPath(t: EntryTuple): EntryTuple {
  const fix = (a: string) => a.replace(/^.*\/tmp\.<RAND>:\/out$/, "<WORK>:/out");
  return { ...t, dockerCalls: t.dockerCalls.map((c) => c.map(fix)) };
}

const skip = shellLegPrerequisites() ?? false;
const GEMINI = "tests/e2e/lib/test-gemini-headless";

function bundle(box: EntryBox): void {
  const dir = path.join(box.e2eHome, "gemini");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "settings.json"), "{}");
  fs.writeFileSync(path.join(dir, "oauth_creds.json"), "{}");
}

const gemini: EntryCase[] = [
  { id: "gemini/no-docker", file: GEMINI, env: { PATH: "/nonexistent" } },
  {
    id: "gemini/no-image",
    file: GEMINI,
    missingImages: ["crewrig/e2e-gemini:latest"],
    forbidRun: true,
  },
  {
    id: "gemini/custom-image",
    file: GEMINI,
    env: { GEMINI_IMAGE: "x/y:z" },
    missingImages: ["x/y:z"],
    forbidRun: true,
  },
  { id: "gemini/no-bundle", file: GEMINI, forbidRun: true },
  { id: "gemini/ok-stdout", file: GEMINI, seed: bundle, fixtures: [{ stdout: "READY\n" }] },
  {
    id: "gemini/ok-answer",
    file: GEMINI,
    seed: bundle,
    fixtures: [{ files: { "/out/answer.txt": "READY" } }],
  },
  {
    id: "gemini/exit-124",
    file: GEMINI,
    seed: bundle,
    fixtures: [{ exit: 124, stdout: "READY\n" }],
  },
  { id: "gemini/no-answer", file: GEMINI, seed: bundle, fixtures: [{ stderr: "boom\n" }] },
  {
    id: "gemini/bad-exit",
    file: GEMINI,
    seed: bundle,
    fixtures: [{ exit: 5, stdout: "x", stderr: "denied\n" }],
  },
];

describe("e2e capture and gemini smoke: shell leg versus TypeScript twin", { skip }, () => {
  for (const c of gemini) {
    it(c.id, { skip: shellLegSkipReason(path.join(REPO_ROOT, `${c.file}.sh`)) }, (t) => {
      const ts = runEntry(c, "entry");
      if (ts === null) return t.todo("no TypeScript twin yet");
      const sh = runEntry(c, "shell");
      assert.ok(sh !== null);
      assert.deepEqual(workPath(ts), workPath(sh));
    });
  }
});

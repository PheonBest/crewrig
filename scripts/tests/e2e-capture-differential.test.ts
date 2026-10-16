// e2e-capture-differential.test.ts — e2e-capture-versions.sh against its TypeScript twin and
// test-gemini-headless.sh against its twin (spec 0261 R10): same rc, streams, files, Docker calls.

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
import fs from "node:fs";
import path from "node:path";

/** macOS mktemp ignores TMPDIR, GNU mktemp honours it: only the parent of `tmp.<RAND>` differs. */
function workPath(t: EntryTuple): EntryTuple {
  const fix = (a: string) => a.replace(/^.*\/tmp\.<RAND>:\/out$/, "<WORK>:/out");
  return { ...t, dockerCalls: t.dockerCalls.map((c) => c.map(fix)) };
}

const skip = shellLegPrerequisites() ?? false;
const CAPTURE = "scripts/e2e-capture-versions";
const GEMINI = "tests/e2e/lib/test-gemini-headless";

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

const capture: EntryCase[] = [
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
  for (const c of [...capture, ...gemini]) {
    it(c.id, (t) => {
      const ts = runEntry(c, "entry");
      if (ts === null) return t.todo("no TypeScript twin yet");
      const sh = runEntry(c, "shell");
      assert.ok(sh !== null);
      assert.deepEqual(workPath(ts), workPath(sh));
    });
  }
});

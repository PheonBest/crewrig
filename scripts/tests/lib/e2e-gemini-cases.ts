// e2e-gemini-cases.ts — the cases of the gemini headless smoke entry (spec 0261 R10), shared by the
// literal-golden test and the recorder that produced the golden from the real shell script.

import fs from "node:fs";
import path from "node:path";

import type { EntryBox, EntryCase, EntryTuple } from "./e2e-entry-diff.ts";

/** macOS mktemp ignores TMPDIR, GNU mktemp honours it: only the parent of `tmp.<RAND>` differs. */
export function workPath(t: EntryTuple): EntryTuple {
  const fix = (a: string) => a.replace(/^.*\/tmp\.<RAND>:\/out$/, "<WORK>:/out");
  return { ...t, dockerCalls: t.dockerCalls.map((c) => c.map(fix)) };
}

const GEMINI = "tests/e2e/lib/test-gemini-headless";

function bundle(box: EntryBox): void {
  const dir = path.join(box.e2eHome, "gemini");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "settings.json"), "{}");
  fs.writeFileSync(path.join(dir, "oauth_creds.json"), "{}");
}

export const gemini: EntryCase[] = [
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

// sync-from-upstream-reconcile.test.ts — reconcile_dir behaviour of scripts/sync-from-upstream.ts
// (spec 0021; spec 0260 replacement of group G3, cases h-m, of test-sync-from-upstream.sh).

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import {
  cloneShallow,
  commitFiles,
  createSyncRoot,
  exists,
  git,
  makeAdopter,
  makeUpstream,
  read,
  runSync,
  tomlPath,
  why,
  writeFile,
  type SyncRoot,
} from "./lib/sync-fixture.ts";

let sr: SyncRoot;
before(() => {
  sr = createSyncRoot("crewrig-sync-rec-");
});
after(() => sr.dispose());

const MANIFEST = ["config/expertise\tadopt-on-edit", ".crewrig/.synced-markers\texcluded"];
const BACKEND = "config/expertise/BACKEND-JAVA.md";
const QA = "config/expertise/QA-AUTOMATION.md";

describe("G3 reconcile_dir (spec 0021)", () => {
  test("h R3 ADD: a new upstream file is added although upstream is a fetched named remote", () => {
    const upstream = makeUpstream(sr, [
      {
        [BACKEND]: "upstream backend",
        "config/expertise/DATA-ENGINEER.md": "upstream data engineer",
      },
    ]);
    const adopter = makeAdopter(sr, {
      upstream,
      manifest: MANIFEST,
      files: { [BACKEND]: "upstream backend" },
    });
    git(sr, adopter, "remote", "add", "canonical", tomlPath(upstream));
    git(sr, adopter, "fetch", "-q", "canonical");
    const out = runSync(sr, adopter);
    assert.equal(out.status, 0, why(out));
    assert.equal(read(adopter, "config/expertise/DATA-ENGINEER.md"), "upstream data engineer");
  });

  test("i R2 SKIP: an org-deleted file stays gone", () => {
    const upstream = makeUpstream(sr, [{ [QA]: "upstream qa" }]);
    const adopter = makeAdopter(sr, {
      upstream,
      manifest: MANIFEST,
      files: { [QA]: "upstream qa" },
    });
    git(sr, adopter, "rm", "-q", QA);
    git(sr, adopter, "commit", "-q", "-m", "drop QA role");
    const out = runSync(sr, adopter);
    assert.equal(out.status, 0, why(out));
    assert.ok(!exists(adopter, QA), "org-deleted file was re-created");
  });

  test("j customised directory member is frozen", () => {
    const upstream = makeUpstream(sr, [
      { [BACKEND]: "upstream backend v1" },
      { [BACKEND]: "upstream backend v2" },
    ]);
    const adopter = makeAdopter(sr, {
      upstream,
      manifest: MANIFEST,
      files: { [BACKEND]: "upstream backend v1" },
    });
    writeFile(adopter, BACKEND, "ORG customised backend\n");
    const out = runSync(sr, adopter);
    assert.equal(out.status, 0, why(out));
    assert.equal(read(adopter, BACKEND), "ORG customised backend\n");
  });

  test("k untouched directory member (older upstream blob) updates", () => {
    const front = "config/expertise/FRONTEND-REACT.md";
    const upstream = makeUpstream(sr, [
      { [front]: "upstream frontend v1" },
      { [front]: "upstream frontend v2" },
    ]);
    const adopter = makeAdopter(sr, {
      upstream,
      manifest: MANIFEST,
      files: { [front]: "upstream frontend v1" },
    });
    const out = runSync(sr, adopter);
    assert.equal(out.status, 0, why(out));
    assert.equal(read(adopter, front), "upstream frontend v2");
  });

  test("l org-deleted file stays gone after upstream re-touches it (two syncs)", () => {
    const upstream = makeUpstream(sr, [{ [QA]: "upstream qa v1" }]);
    const adopter = makeAdopter(sr, {
      upstream,
      manifest: MANIFEST,
      files: { [QA]: "upstream qa v1" },
    });
    git(sr, adopter, "rm", "-q", QA);
    git(sr, adopter, "commit", "-q", "-m", "drop QA role");
    runSync(sr, adopter); // first run: exit status deliberately ignored, as in the Bash case
    commitFiles(sr, upstream, "revive qa upstream", { [QA]: "upstream qa v2" });
    const out = runSync(sr, adopter);
    assert.equal(out.status, 0, why(out));
    assert.ok(!exists(adopter, QA), "org-deleted file came back after the upstream re-touch");
  });

  test("m shallow adopter: exit 0, stderr says shallow, the new file is not added", () => {
    const upstream = makeUpstream(sr, [
      {
        [BACKEND]: "upstream backend",
        "config/expertise/DATA-ENGINEER.md": "upstream data engineer",
      },
    ]);
    const seed = makeUpstream(sr, [
      { [BACKEND]: "upstream backend", "filler.txt": "v1" },
      { "filler.txt": "v2" },
    ]);
    const adopter = cloneShallow(sr, seed);
    commitFiles(sr, adopter, "adopter config", {
      "crewrig.config.toml": `canonical_repo = "${tomlPath(upstream)}"\n`,
      ".crewrig/core-paths.txt": `${MANIFEST.join("\n")}\n`,
    });
    const out = runSync(sr, adopter);
    assert.equal(out.status, 0, why(out));
    assert.ok(out.stderr.includes("shallow"), why(out));
    assert.ok(
      !exists(adopter, "config/expertise/DATA-ENGINEER.md"),
      "file was added on a shallow clone",
    );
  });
});

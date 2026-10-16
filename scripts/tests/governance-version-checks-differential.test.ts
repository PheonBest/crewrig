// Differential test of the `version-checks` group (spec 0259 R26): for every check, the real-repository
// leg and the unchanged Bash suite through the shell-versus-TypeScript tee. The two base-ref checks get
// a second, stronger real-repository leg: a two-commit sandbox whose first commit is the tracked tree
// of the merge-base of HEAD with origin/release/1231-ts-migration (HEAD~1 when absent) and whose second
// commit is the current working tree, so both legs diff real PR content with BASE_REF=HEAD~1.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { REPO } from "./lib/build-fixture-tree.ts";
import {
  casesOf,
  checkNeeds,
  runRealRepo,
  runSuiteThroughTee,
} from "./lib/governance-differential.ts";
import { installTee, makeSandbox, runScript } from "./lib/governance-sandbox.ts";

const RELEASE_REF = "origin/release/1231-ts-migration";
const GIT_ID = [
  "-c",
  "user.name=gov",
  "-c",
  "user.email=gov@example.invalid",
  "-c",
  "core.autocrlf=false",
];

function git(cwd: string, args: readonly string[]): string {
  const r = spawnSync("git", [...GIT_ID, ...args], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

/** The revision whose tracked tree is the first commit: merge-base with the release ref, else HEAD~1. */
function baseRevision(): string {
  const probe = spawnSync("git", ["merge-base", "HEAD", RELEASE_REF], {
    cwd: REPO,
    encoding: "utf8",
  });
  if (probe.status === 0 && probe.stdout.trim() !== "") return probe.stdout.trim();
  const parent = spawnSync("git", ["rev-parse", "HEAD~1"], { cwd: REPO, encoding: "utf8" });
  if (parent.status === 0 && parent.stdout.trim() !== "") return parent.stdout.trim();
  // A single-commit checkout (shallow clone, container copy): the leg degrades to a self-diff.
  return git(REPO, ["rev-parse", "HEAD"]);
}

for (const c of casesOf("version-checks")) {
  const twin = fs.existsSync(path.join(REPO, "scripts", `${c.name}.ts`));
  const missing = checkNeeds(c);
  const skip = !twin
    ? "TypeScript twin not present"
    : missing.length > 0
      ? `host lacks ${missing.join(", ")}`
      : false;

  test(`${c.name}: real repository through the tee`, { skip }, () => {
    const t = runRealRepo(c);
    assert.notEqual(t.status, 99);
    assert.equal(t.status, 0, `${t.stdout}${t.stderr}`);
  });

  test(
    `${c.name}: unchanged Bash suite through the tee`,
    { skip: c.suite === null ? "no Bash suite" : skip },
    () => {
      runSuiteThroughTee(c);
    },
  );

  test(
    `${c.name}: two-commit sandbox of real PR content (BASE_REF=HEAD~1)`,
    { skip: c.needsCommit === true ? skip : "no base ref" },
    () => {
      const sandbox = makeSandbox();
      try {
        const base = baseRevision();
        git(sandbox.root, ["fetch", "-q", "--no-tags", "--depth=1", `file://${REPO}`, base]);
        const tree = git(sandbox.root, ["rev-parse", `${base}^{tree}`]);
        const first = git(sandbox.root, ["commit-tree", tree, "-m", "base"]);
        git(sandbox.root, ["update-ref", "HEAD", first]);
        git(sandbox.root, ["add", "-A"]);
        git(sandbox.root, ["commit", "-q", "--allow-empty", "-m", "working tree"]);
        installTee(sandbox, c.name, { mutating: c.mutating, statusOnly: c.statusOnly });
        const r = runScript(sandbox, c.name, { env: { BASE_REF: "HEAD~1" } });
        const text = `${r.stdout}${r.stderr}`;
        assert.ok(
          r.status !== 99 && !r.stderr.includes("governance-tee: DIVERGENCE"),
          `${c.name}: tee divergence (exit ${r.status})\n${text}`,
        );
        assert.ok(!/Cannot find module|ERR_MODULE_NOT_FOUND/.test(r.stderr), text);
        assert.notEqual(r.status, 2, `base ref unresolvable\n${text}`);
        assert.match(r.stdout, /^(OK|Checking|FAILED)/m, text);
      } finally {
        sandbox.dispose();
      }
    },
  );
}

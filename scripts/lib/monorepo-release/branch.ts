// branch.ts — the branch the release runs from (spec 0213, spec 0257 R13). Replaced
// release_branch, release_pr_branch and the release-PR-branch guard of the former monorepo-release.sh.

import { git } from "../sync-from-upstream/git.ts";
import type { Forge } from "./forge.ts";
import { ReleaseRefusal } from "./refusal.ts";

/** The checked-out branch, as `git rev-parse --abbrev-ref HEAD` printed it (`$(...)` trimmed). */
export function gitBranch(cwd?: string): string {
  const result = git(["rev-parse", "--abbrev-ref", "HEAD"], cwd === undefined ? {} : { cwd });
  if (result.status !== 0) {
    throw new Error(`git rev-parse --abbrev-ref HEAD failed: ${result.stderr.trim()}`);
  }
  return result.stdout.replace(/\n+$/, "");
}

/**
 * GitHub: the checked-out branch. GitLab: CI_COMMIT_BRANCH, which GitLab sets on branch
 * pipelines only; a merge-request or tag pipeline (detached checkout, empty variable) is refused.
 */
export function releaseBranch(
  forge: Forge,
  env: NodeJS.ProcessEnv,
  gitRevParse: () => string,
): string {
  if (forge === "github") return gitRevParse();
  const commitBranch = env["CI_COMMIT_BRANCH"] ?? "";
  if (env["CI_PIPELINE_SOURCE"] === "merge_request_event" || commitBranch === "") {
    throw new ReleaseRefusal(
      "not a branch pipeline (merge-request or tag): run the release from a branch pipeline",
    );
  }
  return commitBranch;
}

/**
 * Publish mode only. The release PR's own head branch is never a release branch: its versions
 * are committed but unmerged, so every extension would classify as publish and be tagged from an
 * unreviewed branch (issue #1379).
 */
export function assertNotReleasePrBranch(forge: Forge, branch: string): void {
  if (forge === "github" && branch.startsWith("release-pr/")) {
    throw new ReleaseRefusal(
      `refusing to publish from a release PR branch (${branch}): merge the release PR instead`,
    );
  }
}

/** The head branch of the release PR targeting <branch> (issue #1379). */
export function releasePrBranch(branch: string): string {
  return `release-pr/${branch}`;
}

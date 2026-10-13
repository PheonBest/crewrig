// mirror.ts — the throwaway bare mirror of HEAD (and its tags) and the clone the rehearsal runs the
// release engine in (spec 0257 R17, Decision D4). Port of release_make_mirror and
// release_reconcile_tags of scripts/monorepo-release.sh. Git is the only program spawned, and the
// checkout and the remote are only ever read: every write lands in the mirror or the clone.

import path from "node:path";

import { git, lines } from "../sync-from-upstream/git.ts";
import type { GitResult } from "../sync-from-upstream/git.ts";
import { ReleaseFailure } from "./failure.ts";

export type GitEnv = Readonly<Record<string, string | undefined>>;

export interface MirrorOptions {
  /** The repository being released; the mirror is pushed from it. */
  readonly checkout: string;
  /** The rehearsal directory holding `mirror.git` and `clone`. */
  readonly dir: string;
  readonly branch: string;
  /** The forge's own clone URL, redirected to the mirror in the clone's configuration. */
  readonly forgeUrl: string;
  readonly env: GitEnv;
  readonly out: (line: string) => void;
}

/** Where the mirror and the clone of a rehearsal directory live. */
export function mirrorPaths(dir: string): { readonly mirror: string; readonly clone: string } {
  return { mirror: path.join(dir, "mirror.git"), clone: path.join(dir, "clone") };
}

/** Run git, failing (like the shell's `set -e`) with git's own message when it exits non-zero. */
function mustGit(args: readonly string[], cwd: string, env: GitEnv): GitResult {
  const result = git(args, { cwd, env });
  if (result.status !== 0) {
    const detail = result.stderr.trim();
    throw new ReleaseFailure(`git ${args[0] ?? ""} failed${detail === "" ? "" : `: ${detail}`}`);
  }
  return result;
}

/**
 * The remote `*-v*` tags as name -> commit: the peeled (`^{}`) commit of an annotated tag wins, the
 * first plain entry is used otherwise. Insertion order is the listing order.
 */
function parseRemoteTags(listing: string): Map<string, string> {
  const plain = new Map<string, string>();
  const peeled = new Map<string, string>();
  for (const line of lines(listing)) {
    const fields = line.split(/\s+/);
    if (fields.length !== 2) continue;
    const [sha, ref] = fields as [string, string];
    const name = ref.replace(/^refs\/tags\//, "");
    if (name.endsWith("^{}")) peeled.set(name.slice(0, -3), sha);
    else if (!plain.has(name)) plain.set(name, sha);
  }
  return new Map([...plain].map(([name, sha]) => [name, peeled.get(name) ?? sha]));
}

/**
 * Create, in the MIRROR only, every remote `*-v*` tag that the checkout lacks but whose commit is
 * local and an ancestor of HEAD. With full-depth history every commit reachable from HEAD is local,
 * so this recovers exactly the reachable baselines the tag format needs, whatever tags the CI
 * checkout fetched.
 */
export function reconcileTags(mirror: string, checkout: string, env: GitEnv): void {
  const listing = git(["ls-remote", "--tags", "origin", "*-v*"], { cwd: checkout, env });
  if (listing.status !== 0) throw new ReleaseFailure("rehearsal cannot list the tags of origin");
  for (const [name, sha] of parseRemoteTags(listing.stdout)) {
    const have = git(["rev-parse", "-q", "--verify", `refs/tags/${name}`], { cwd: checkout, env });
    if (have.status === 0) continue;
    const local = git(["cat-file", "-e", `${sha}^{commit}`], { cwd: checkout, env });
    if (local.status !== 0) continue;
    if (git(["merge-base", "--is-ancestor", sha, "HEAD"], { cwd: checkout, env }).status !== 0) {
      continue;
    }
    mustGit(["-C", mirror, "update-ref", `refs/tags/${name}`, sha], checkout, env);
  }
}

/**
 * A bare mirror of HEAD and its tags at `<dir>/mirror.git` and a clone of it at `<dir>/clone`, whose
 * real forge URL is redirected to the mirror, so every engine git operation stays local.
 */
export function makeMirror(opts: MirrorOptions): void {
  const { checkout, branch, env } = opts;
  const { mirror, clone } = mirrorPaths(opts.dir);
  mustGit(["init", "--bare", "-q", mirror], checkout, env);
  // --no-verify: pushing to the mirror is a push FROM the checkout, so it would otherwise run the
  // checkout's pre-push hook (plan review v2-F3). Pushing to a path writes no remote-tracking ref.
  mustGit(
    ["push", "--no-verify", "-q", mirror, `HEAD:refs/heads/${branch}`, "refs/tags/*:refs/tags/*"],
    checkout,
    env,
  );
  reconcileTags(mirror, checkout, env);

  const heads = git(["ls-remote", "--heads", "origin", branch], { cwd: checkout, env });
  const remoteHead = (lines(heads.stdout)[0] ?? "").split(/\s+/)[0] ?? "";
  const head = mustGit(["rev-parse", "HEAD"], checkout, env).stdout.trim();
  if (remoteHead !== "" && remoteHead !== head) {
    opts.out("NOTICE remote branch has advanced; rehearsing HEAD");
  }

  mustGit(["-C", mirror, "symbolic-ref", "HEAD", `refs/heads/${branch}`], checkout, env);
  mustGit(["clone", "-q", "--branch", branch, mirror, clone], checkout, env);
  mustGit(["-C", clone, "config", `url.${mirror}.insteadOf`, opts.forgeUrl], checkout, env);
}

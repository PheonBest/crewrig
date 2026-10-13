// flow-github.ts — the GitHub publish flow, the release-PR flow of issue #1379 (spec 0257 R14).
// Port of release_github and release_engine_run of scripts/monorepo-release.sh. The `main-protected`
// ruleset rejects any runner-made commit on the release branch, so the flow works in a throwaway
// clone: it classifies every extension, publishes the ones a merged release PR committed, prepares
// the pending ones as commits in the clone, force-pushes those to the release PR branch and lets
// `release-pr.ts sync` open, update or close the PR.

import fs from "node:fs";
import path from "node:path";

import { releasePrBranch } from "./branch.ts";
import { classify } from "./classify.ts";
import { fallbackNotice } from "./clone-modules.ts";
import type { ReleaseCtx } from "./context.ts";
import { stripCredentials } from "./credentials.ts";
import { extensionDirs } from "./extension-dirs.ts";
import { realDeps } from "./flow-deps.ts";
import type { FlowDeps } from "./flow-deps.ts";
import { releasePublish } from "./flow-gitlab.ts";
import { forgeUrl } from "./forge.ts";
import { failedStep } from "./log-parse.ts";
import { mirrorPaths } from "./mirror.ts";
import { emitReleaserc } from "./releaserc.ts";

interface Entry {
  readonly ext: string;
  readonly version: string;
  readonly tag: string;
  readonly notes: string;
}

/** `jq -r '.<name> // ""'` on the engine's JSON: absent, null and false read as empty. */
function field(doc: Record<string, unknown>, name: string): string {
  const value = doc[name];
  if (value === null || value === undefined || value === false) return "";
  return typeof value === "string" ? value : String(value);
}

/** The engine's JSON verdict, or `undefined` when its stdout is not a JSON object. */
function readVerdict(file: string): Record<string, unknown> | undefined {
  try {
    const doc: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return undefined;
    return doc as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function readText(file: string): string {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

/** The version a clone directory's committed package.json carries (`jq -r '.version // ""'`). */
function manifestVersion(dir: string): string {
  const doc = readVerdict(path.join(dir, "package.json"));
  return doc === undefined ? "" : field(doc, "version");
}

interface Engine {
  readonly r: string;
  readonly clone: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}

/**
 * The engine for one extension of the clone, credential-free, through the rehearsal helper. Its
 * log goes to standard error and to `<r>/<ext>.<mode>.log`; its JSON verdict to `json`. Resolves
 * to the engine's exit status.
 */
async function engineRun(
  ctx: ReleaseCtx,
  deps: FlowDeps,
  eng: Engine,
  dir: string,
  mode: "rehearsal" | "prepare",
  json: string,
): Promise<number> {
  const ext = path.basename(dir);
  const releaserc = path.join(eng.r, `${ext}.${mode}.releaserc.json`);
  const libDir = path.join(ctx.scriptsDir, "lib");
  fs.writeFileSync(
    releaserc,
    emitReleaserc({
      forge: ctx.forge,
      mode,
      ext,
      root: eng.clone,
      out: path.join(eng.r, "out", ext),
      branch: ctx.branch,
      libDir,
      env: ctx.env,
      platform: ctx.platform,
    }),
  );
  const run = await deps.runRehearse({
    dir,
    libDir,
    branch: ctx.branch,
    releasercPath: releaserc,
    apply: mode === "prepare",
    env: eng.env,
    stderr: ctx.errRaw,
    logFile: path.join(eng.r, `${ext}.${mode}.log`),
  });
  fs.writeFileSync(json, run.json);
  fs.rmSync(releaserc, { force: true });
  return run.status;
}

/** Step 4: the clone's commits to the release PR branch, from the checkout. */
function pushReleaseBranch(ctx: ReleaseCtx, deps: FlowDeps, clone: string, head: string): boolean {
  const opts = { cwd: ctx.rootDir, env: ctx.env };
  // --no-verify: a push FROM the checkout would run its pre-push hook.
  const fetched = deps.runGit(["fetch", "-q", clone, `refs/heads/${ctx.branch}`], opts);
  if (fetched.status !== 0) return false;
  const pushed = deps.runGit(
    ["push", "--no-verify", "--force", "-q", "origin", `FETCH_HEAD:refs/heads/${head}`],
    opts,
  );
  return pushed.status === 0;
}

export async function releaseGithub(ctx: ReleaseCtx, deps: FlowDeps = realDeps): Promise<void> {
  const r = path.join(ctx.scratch.dir, "release-pr");
  fs.mkdirSync(r, { recursive: true });
  const { clone } = mirrorPaths(r);
  deps.makeMirror({
    checkout: ctx.rootDir,
    dir: r,
    branch: ctx.branch,
    forgeUrl: forgeUrl(ctx.forge, ctx.env),
    env: ctx.env,
    out: ctx.out,
  });
  const notice = fallbackNotice(deps.stageCloneModules({ rootDir: ctx.rootDir, cloneDir: clone }));
  if (notice !== "") ctx.err(notice);

  const eng: Engine = { r, clone, env: stripCredentials(ctx.env) };
  const head = releasePrBranch(ctx.branch);
  let incomplete = false;
  const publishDirs: string[] = [];
  const pendingDirs: string[] = [];

  // 1. Classify every extension from the engine's dry run on the branch head.
  for (const dir of extensionDirs(clone)) {
    if (!fs.existsSync(path.join(dir, "package.json"))) continue;
    if (ctx.aborted()) break;
    const ext = path.basename(dir);
    ctx.out("");
    ctx.out(`--- Analyzing: ${ext} ---`);
    const json = path.join(r, `${ext}.classify.json`);
    const status = await engineRun(ctx, deps, eng, dir, "rehearsal", json);
    const verdict = status === 0 ? readVerdict(json) : undefined;
    if (verdict === undefined) {
      ctx.out(`RELEASE-FAILED ${ext} step=engine`);
      ctx.errors = 1;
      incomplete = true;
      continue;
    }
    const kind = classify(
      field(verdict, "released") === "true" ? "true" : "false",
      field(verdict, "version"),
      manifestVersion(dir),
    );
    if (kind === "unchanged") ctx.out(`UNCHANGED ${ext}`);
    else if (kind === "publish") {
      publishDirs.push(`${path.relative(clone, dir).split(path.sep).join("/")}/`);
    } else pendingDirs.push(dir);
  }

  // 2. Publish the releases a merged release PR committed.
  if (publishDirs.length > 0 && !ctx.aborted()) await releasePublish(ctx, publishDirs, deps);

  // 3. Commit every pending release in the clone, against the mirror.
  const entries: Entry[] = [];
  const entriesFile = path.join(r, "entries.json");
  fs.writeFileSync(entriesFile, "[]\n");
  for (const dir of pendingDirs) {
    if (ctx.aborted()) break;
    const ext = path.basename(dir);
    ctx.out("");
    ctx.out(`--- Preparing the release PR: ${ext} ---`);
    const json = path.join(r, `${ext}.prepare.json`);
    const status = await engineRun(ctx, deps, eng, dir, "prepare", json);
    const verdict = status === 0 ? readVerdict(json) : undefined;
    if (verdict === undefined || field(verdict, "released") !== "true") {
      ctx.out(
        `RELEASE-FAILED ${ext} step=${failedStep(readText(path.join(r, `${ext}.prepare.log`)))}`,
      );
      ctx.errors = 1;
      incomplete = true;
      // Drop the failed extension's partial changes; earlier commits stay.
      const opts = { env: ctx.env };
      deps.runGit(["-C", clone, "reset", "-q", "--hard"], opts);
      deps.runGit(["-C", clone, "clean", "-q", "-fd"], opts);
      continue;
    }
    const entry: Entry = {
      ext,
      version: field(verdict, "version"),
      tag: field(verdict, "gitTag"),
      notes: field(verdict, "notes"),
    };
    entries.push(entry);
    fs.writeFileSync(entriesFile, `${JSON.stringify(entries, null, 2)}\n`);
    ctx.out(`PENDING ${ext} version=${entry.version} tag=${entry.tag}`);
  }

  // A termination signal must not reach the sync: an empty entries list would close a release PR.
  if (ctx.aborted()) return;

  // 4. Push the release branch, then open/update/close the release PR and dispatch its required
  // checks. A run in which an extension could not be classified or prepared, and which is left
  // with nothing to propose, must not close a release PR still open: it may carry that extension.
  if (entries.length > 0) {
    if (!pushReleaseBranch(ctx, deps, clone, head)) {
      ctx.out("RELEASE-FAILED release-pr step=push");
      ctx.errors = 1;
      return;
    }
    ctx.out(`RELEASE-PR-BRANCH ${head}`);
  } else if (incomplete) {
    return;
  }
  const synced = await deps.runReleasePr(["sync", ctx.branch, head, entriesFile], {
    cwd: ctx.rootDir,
    env: ctx.env,
    scriptsDir: ctx.scriptsDir,
  });
  if (synced !== 0) {
    ctx.out("RELEASE-FAILED release-pr step=pr");
    ctx.errors = 1;
  }
}

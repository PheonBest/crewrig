// flow-gitlab.ts — the publish flow (spec 0257 R14). Port of release_publish of
// scripts/monorepo-release.sh: for each extension the engine runs in the extension directory with
// its output teed to the driver's stdout and to a log, and the log decides the report line
// (PUBLISHED, UNCHANGED or RELEASE-FAILED with the failed step and any tag the run created).

import fs from "node:fs";
import path from "node:path";

import { credentialHelperOverrides } from "./credentials.ts";
import { extensionDirs, firstArchive } from "./extension-dirs.ts";
import { realDeps } from "./flow-deps.ts";
import type { FlowDeps } from "./flow-deps.ts";
import type { ReleaseCtx } from "./context.ts";
import { createdTag, failedStep } from "./log-parse.ts";
import { emitReleaserc } from "./releaserc.ts";
import { DistLedger } from "./scratch.ts";

/** The directories to publish: the given ones (relative to the root) or every extension. */
function selectDirs(ctx: ReleaseCtx, dirs: readonly string[] | undefined): string[] {
  if (dirs !== undefined) return dirs.map((dir) => path.resolve(ctx.rootDir, dir));
  return extensionDirs(ctx.rootDir);
}

export async function releasePublish(
  ctx: ReleaseCtx,
  dirs?: readonly string[],
  deps: FlowDeps = realDeps,
): Promise<void> {
  const logDir = path.join(ctx.scratch.dir, "publish-logs");
  fs.mkdirSync(logDir, { recursive: true });
  const ledger = new DistLedger();
  ledger.begin(path.join(ctx.rootDir, "dist"));

  // GitLab only: the push must authenticate with the release token, not the runner's job-token helper.
  const env =
    ctx.forge === "gitlab" ? { ...ctx.env, ...credentialHelperOverrides(ctx.env) } : ctx.env;

  const published = selectDirs(ctx, dirs).filter((dir) =>
    fs.existsSync(path.join(dir, "package.json")),
  );
  try {
    for (const dir of published) {
      if (ctx.aborted()) break;
      const ext = path.basename(dir);
      ctx.out("");
      ctx.out(`--- Analyzing: ${ext} ---`);

      // The packager writes exactly one archive per invocation and refuses to run twice into a
      // non-empty directory, so the output directory is recreated empty rather than left to
      // accumulate a stray asset across retried runs (spec 0183 R17/R21/R22).
      const out = path.join(ctx.rootDir, "dist", "release", ext);
      fs.rmSync(out, { recursive: true, force: true });
      fs.mkdirSync(out, { recursive: true });

      const releaserc = path.join(ctx.rootDir, "dist", "release", `${ext}.releaserc.json`);
      fs.writeFileSync(
        releaserc,
        emitReleaserc({
          forge: ctx.forge,
          mode: "publish",
          ext,
          root: ctx.rootDir,
          out,
          branch: ctx.branch,
          libDir: path.join(ctx.scriptsDir, "lib"),
          env: ctx.env,
          platform: ctx.platform,
        }),
      );

      const log = path.join(logDir, `${ext}.log`);
      ctx.out(`Running semantic-release for ${ext}...`);
      const { status, output } = await deps.runSemanticRelease({
        dir,
        branch: ctx.branch,
        releasercPath: releaserc,
        env,
        logFile: log,
        out: ctx.outRaw,
        platform: ctx.platform,
      });
      fs.rmSync(releaserc, { force: true });

      const tag = createdTag(output);
      if (status !== 0) {
        ctx.out(`RELEASE-FAILED ${ext} step=${failedStep(output)}`);
        if (tag !== "") ctx.out(`RELEASE-INCOMPLETE-TAG ${tag}`);
        ctx.errors = 1;
      } else if (tag !== "") {
        const archive = firstArchive(out);
        ctx.out(
          archive === undefined
            ? `PUBLISHED ${ext} tag=${tag} archive=none sha256=none`
            : `PUBLISHED ${ext} tag=${tag} archive=${path.basename(archive)} sha256=${deps.sha256File(archive)}`,
        );
      } else {
        ctx.out(`UNCHANGED ${ext}`);
      }
    }
  } finally {
    // Remove only what this run created: the whole dist/ when it did not exist before the run,
    // otherwise just this run's release output directories.
    ledger.cleanup(published.map((dir) => path.basename(dir)));
  }
}

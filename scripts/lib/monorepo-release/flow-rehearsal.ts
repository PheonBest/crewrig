// flow-rehearsal.ts — the rehearsal flow (spec 0257 R14, R17). Port of release_rehearse of
// scripts/monorepo-release.sh: the engine runs against a throwaway clone whose forge URL is the
// local mirror, with every credential stripped from its environment, and the extension is packaged
// exactly as the exec plugin would. Nothing is ever published.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { fallbackNotice } from "./clone-modules.ts";
import type { ReleaseCtx } from "./context.ts";
import { stripCredentials } from "./credentials.ts";
import { extensionDirs, firstArchive } from "./extension-dirs.ts";
import { realDeps } from "./flow-deps.ts";
import type { FlowDeps } from "./flow-deps.ts";
import { forgeUrl } from "./forge.ts";
import { isSemver } from "./log-parse.ts";
import { mirrorPaths } from "./mirror.ts";
import { prepareCmd } from "./prepare-cmd.ts";
import { emitReleaserc } from "./releaserc.ts";

interface Verdict {
  readonly released: boolean;
  readonly version: string;
  readonly tag: string;
  readonly last: string;
  readonly notes: string;
}

/** `jq -r` of a scalar: a string as is, `null` as the word `null`. */
function raw(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "null";
  return String(value);
}

/** The engine's JSON verdict, or `undefined` when its stdout is not a JSON object. */
function parseVerdict(json: string): Verdict | undefined {
  let doc: unknown;
  try {
    doc = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (typeof doc !== "object" || doc === null) return undefined;
  const fields = doc as Record<string, unknown>;
  const last = fields["lastTag"];
  return {
    released: raw(fields["released"]) === "true",
    version: raw(fields["version"]),
    tag: raw(fields["gitTag"]),
    // jq's `// "none"` replaces both null and false.
    last: last === null || last === undefined || last === false ? "none" : raw(last),
    notes: raw(fields["notes"]),
  };
}

/**
 * Run the command string the engine would hand to `@semantic-release/exec`. A platform shell is
 * the one legitimate shell here: the string is that plugin's own input (sh -c on POSIX, cmd.exe on
 * Windows), built by `prepareCmd` from validated paths.
 */
function runPrepare(
  command: string,
  cwd: string,
  env: Readonly<Record<string, string | undefined>>,
): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, { shell: true, cwd, env: { ...env }, stdio: "inherit" });
    child.once("error", () => resolve(127));
    child.once("close", (code) => resolve(code ?? 1));
  });
}

export async function releaseRehearse(ctx: ReleaseCtx, deps: FlowDeps = realDeps): Promise<void> {
  const r = path.join(ctx.scratch.dir, "rehearsal");
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

  // Defence in depth: the no-publication guarantee itself rests on the absent publish leg and the
  // mirror redirect.
  const engineEnv = stripCredentials(ctx.env);
  const buildPrepare = deps.prepareCommand ?? prepareCmd;

  for (const dir of extensionDirs(clone)) {
    if (!fs.existsSync(path.join(dir, "package.json"))) continue;
    if (ctx.aborted()) break;
    const ext = path.basename(dir);
    ctx.out("");
    ctx.out(`--- Rehearsing: ${ext} ---`);
    const out = path.join(r, "out", ext);
    fs.mkdirSync(out, { recursive: true });
    const releaserc = path.join(r, `${ext}.releaserc.json`);
    fs.writeFileSync(
      releaserc,
      emitReleaserc({
        forge: ctx.forge,
        mode: "rehearsal",
        ext,
        root: clone,
        out,
        branch: ctx.branch,
        libDir: path.join(ctx.scriptsDir, "lib"),
        env: ctx.env,
        platform: ctx.platform,
      }),
    );

    const run = await deps.runRehearse({
      dir,
      libDir: path.join(ctx.scriptsDir, "lib"),
      branch: ctx.branch,
      releasercPath: releaserc,
      apply: false,
      env: engineEnv,
      stderr: ctx.errRaw,
    });
    if (run.status !== 0) {
      ctx.out(`RELEASE-FAILED ${ext} step=engine`);
      ctx.errors = 1;
      continue;
    }
    fs.rmSync(releaserc, { force: true });

    const verdict = parseVerdict(run.json);
    if (verdict === undefined) {
      ctx.out(`RELEASE-FAILED ${ext} step=engine`);
      ctx.err("Error: the engine verdict is not JSON");
      ctx.errors = 1;
      continue;
    }
    if (!verdict.released) {
      ctx.out(`UNCHANGED ${ext}`);
      continue;
    }
    if (!isSemver(verdict.version)) {
      ctx.out(`RELEASE-FAILED ${ext} step=engine`);
      ctx.err("Error: the engine computed a version that is not SemVer");
      ctx.errors = 1;
      continue;
    }

    // Package exactly as the exec plugin would, in the clone, with the clone's own packager and
    // the computed literal version.
    const command = buildPrepare({
      root: clone,
      ext,
      out,
      version: verdict.version,
      platform: ctx.platform,
    });
    const packaged = await runPrepare(command, dir, ctx.env);
    const archive = packaged === 0 ? firstArchive(out) : undefined;
    if (archive === undefined) {
      ctx.out(`RELEASE-FAILED ${ext} step=package`);
      ctx.errors = 1;
      continue;
    }
    ctx.out(
      `REHEARSAL ${ext} version=${verdict.version} tag=${verdict.tag} baseline=${verdict.last} archive=${path.basename(archive)} sha256=${deps.sha256File(archive)}`,
    );
    ctx.out(verdict.notes);
  }
}

// rehearsal.ts — sync recovery rehearsal in a throwaway clone (spec 0266 R19 and the recovery
// guarantee of the final merge). Everything mutating happens inside a clone this module created with
// mkdtemp; the audited repository is only read, nothing is pushed.

import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { join, sep } from "node:path";
import type { Deps, Section } from "./types.ts";
import { table } from "./types.ts";

export const SYNC_COMMITS = [
  "cad08ac64d30dcd3ed96b4aadaf156ed7673abae",
  "3ef0e4d03c443736efe75a659a0751478ab377a8",
] as const;
export const RELEASE_REF = "origin/release/1231-ts-migration";
export const MAIN_REF = "origin/main";
const SYNC_PATH = "scripts/sync-from-upstream.sh";

export interface RehearsalOptions {
  mergeRehearsal: boolean;
  commits?: readonly string[];
  releaseRef?: string;
  mainRef?: string;
}

export interface RehearsalFacts {
  failures: string[];
}

/** True when `child` resolves strictly inside `parent` (both real paths). */
export function contained(parent: string, child: string): boolean {
  return child.startsWith(parent.endsWith(sep) ? parent : parent + sep) && child !== parent;
}

export function rehearse(d: Deps, opts: RehearsalOptions): Section<RehearsalFacts> {
  const commits = opts.commits ?? SYNC_COMMITS;
  const release = opts.releaseRef ?? RELEASE_REF;
  const main = opts.mainRef ?? MAIN_REF;
  const [shellCommit] = commits;
  const failures: string[] = [];
  const rows: string[][] = [];
  const base = mkdtempSync(join(d.tmpBase, "audit-termination-"));
  const realBase = realpathSync(base);
  const clone = join(realBase, "clone");
  try {
    if (!contained(realpathSync(d.tmpBase), realBase))
      throw new Error("rehearsal directory escaped the temp base");
    const git = (args: string[]): { status: number; stdout: string; stderr: string } => {
      if (!contained(realBase, clone))
        throw new Error("clone path escaped the rehearsal directory");
      return d.run("git", args, clone);
    };
    const cl = d.run("git", ["clone", "--no-local", "--quiet", d.root, clone]);
    if (cl.status !== 0) throw new Error(`clone failed: ${cl.stderr.trim()}`);
    // A clone copies local branches only; bring the remote-tracking refs the audit names.
    const fetched = git([
      "fetch",
      "--quiet",
      d.root,
      "+refs/remotes/origin/*:refs/remotes/origin/*",
    ]);
    if (fetched.status !== 0)
      failures.push(`fetch of remote-tracking refs failed: ${fetched.stderr.trim()}`);
    const check = (label: string, ok: boolean, detail: string): void => {
      rows.push([label, ok ? "PASS" : "FAIL", detail]);
      if (!ok) failures.push(label);
    };
    for (const c of commits) {
      const r = git(["merge-base", "--is-ancestor", c, release]);
      check(`${c.slice(0, 10)} is an ancestor of ${release}`, r.status === 0, `exit ${r.status}`);
    }
    const cat = git(["cat-file", "-e", `${shellCommit}:${SYNC_PATH}`]);
    check(
      `${SYNC_PATH} exists at ${shellCommit?.slice(0, 10)}`,
      cat.status === 0,
      `exit ${cat.status}`,
    );
    if (opts.mergeRehearsal) {
      const co = git(["checkout", "--quiet", "--detach", main]);
      const mg = git([
        "-c",
        "user.name=audit-rehearsal",
        "-c",
        "user.email=audit-rehearsal@example.invalid",
        "merge",
        "--no-ff",
        "--no-edit",
        "-m",
        "rehearsal merge (local, never pushed)",
        release,
      ]);
      check(
        `local merge of ${release} into ${main}`,
        co.status === 0 && mg.status === 0,
        `checkout exit ${co.status}, merge exit ${mg.status}${mg.status === 0 ? "" : `: ${mg.stdout.trim().slice(0, 200)}`}`,
      );
      if (co.status === 0 && mg.status === 0) {
        for (const c of commits) {
          const r = git(["merge-base", "--is-ancestor", c, "HEAD"]);
          check(
            `${c.slice(0, 10)} is an ancestor of the merge result`,
            r.status === 0,
            `exit ${r.status}`,
          );
        }
        const rest = git(["checkout", `${shellCommit}`, "--", SYNC_PATH]);
        let first = "";
        try {
          first = (readFileSync(join(clone, SYNC_PATH), "utf8").split("\n")[0] ?? "").trim();
        } catch {
          first = "(unreadable)";
        }
        check(
          `checkout ${shellCommit?.slice(0, 10)} -- ${SYNC_PATH} restores shell text`,
          rest.status === 0 && first.startsWith("#!"),
          `exit ${rest.status}, first line \`${first}\``,
        );
      }
    }
  } catch (e) {
    failures.push(`rehearsal aborted: ${(e as Error).message}`);
    rows.push(["rehearsal", "FAIL", (e as Error).message]);
  } finally {
    // `base` was created by mkdtemp above; containment re-checked before removal.
    if (contained(realpathSync(d.tmpBase), realBase))
      rmSync(realBase, { recursive: true, force: true });
  }
  const md = [
    "## 6. Sync recovery rehearsal",
    "",
    `Clone: \`git clone --no-local\` of the audited repository into a \`mkdtemp\` directory (removed afterwards); remote-tracking refs fetched from the local repository, no network, no push. Merge rehearsal: ${opts.mergeRehearsal ? "ON" : "OFF (pass --merge-rehearsal)"}.`,
    "",
    table(["check", "result", "detail"], rows),
    "",
    failures.length === 0 ? "Rehearsal: ALL PASS." : `Rehearsal: FAILED: ${failures.join("; ")}.`,
  ].join("\n");
  return { markdown: md, facts: { failures } };
}

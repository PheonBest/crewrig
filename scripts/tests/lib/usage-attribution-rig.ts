// usage-attribution-rig.ts — shared helpers of the usage-attribution suites (spec 0260,
// test-usage-attribution.sh). Every child runs with a scratch HOME/USERPROFILE, its own
// CREWRIG_USAGE_ROOT and palace path, capture-test mode on and mirroring off.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { cleanEnv, realTmp, REPO } from "./worktree-fixtures.ts";

export { REPO, realTmp };
export const DRIVER = path.join(import.meta.dirname, "usage-attribution-driver.ts");
export const FIXTURES = path.join(
  REPO,
  "scripts",
  "tests",
  "fixtures",
  "usage-attribution",
  "records",
);
export const fixture = (name: string): string => path.join(FIXTURES, name);

/** Variables the Bash suite unset, plus the proxies and CI marker a child must not inherit. */
const STRIPPED = [
  "CREWRIG_USAGE_WING",
  "CREWRIG_USAGE_ALLOW_PRUNED",
  "CREWRIG_TASK",
  "CREWRIG_SESSION_ID",
  "CREWRIG_FORGE_HOSTS",
  "CREWRIG_TASK_DECLARATION_TTL_MS",
  "CI",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "http_proxy",
  "https_proxy",
];

export interface Case {
  readonly root: string;
  readonly home: string;
  readonly env: NodeJS.ProcessEnv;
}

/** A fresh case: its own usage root, scratch home and palace path. `extra` overrides env. */
export function newCase(extra: Record<string, string | undefined> = {}): Case {
  const root = realTmp("usage-attr-root-");
  const home = realTmp("usage-attr-home-");
  const env = cleanEnv({
    HOME: home,
    USERPROFILE: home,
    CREWRIG_USAGE_ROOT: root,
    MEMPALACE_PALACE_PATH: path.join(realTmp("usage-attr-palace-"), "palace"),
    CREWRIG_USAGE_CAPTURE_TEST: "1",
    CREWRIG_USAGE_MIRROR: "0",
    NO_PROXY: "127.0.0.1,localhost",
    USAGE_TEST_REPO_DIR: REPO,
    ...extra,
  });
  for (const key of STRIPPED) if (!(key in extra)) delete env[key];
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) env[k] = v;
  return { root, home, env };
}

export interface Out {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function spawn(args: readonly string[], env: NodeJS.ProcessEnv, cwd?: string): Out {
  const res = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", ...args], {
    encoding: "utf8",
    env,
    cwd,
    timeout: 60_000,
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

/** Run one driver command; `extra` adds `ATTR_*` variables (an undefined value deletes it). */
export function driver(
  c: Case,
  args: readonly string[],
  extra: Record<string, string | undefined> = {},
  cwd?: string,
): Out {
  const env = { ...c.env };
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return spawn([DRIVER, ...args], env, cwd);
}

/** Run a `scripts/usage-<name>.ts` entry (query, attribute, prune) with the case environment. */
export function cli(c: Case, name: string, args: readonly string[], repo: string = REPO): Out {
  return spawn([path.join(repo, "scripts", `usage-${name}.ts`), ...args], c.env);
}

/** Run a library script such as `scripts/lib/usage-store/declaration.js` from `cwd`. */
export function libScript(c: Case, rel: string, args: readonly string[], cwd: string): Out {
  return spawn([path.join(REPO, rel), ...args], c.env, cwd);
}

/** Hand-written minimal checkout: `.git/HEAD` and `.git/config` only (no git binary needed). */
export function buildCheckout(dir: string, branch: string, remoteUrl?: string, remote = "origin") {
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".git", "HEAD"), `ref: refs/heads/${branch}\n`);
  let config = "[core]\n\trepositoryformatversion = 0\n";
  if (remoteUrl) {
    config += `[remote "${remote}"]\n\turl = ${remoteUrl}\n`;
    config += `\tfetch = +refs/heads/*:refs/remotes/${remote}/*\n`;
  }
  fs.writeFileSync(path.join(dir, ".git", "config"), config);
}

export const recordId = (file: string): string =>
  (JSON.parse(fs.readFileSync(file, "utf8")) as { recordId: string }).recordId;

/** `<root>/journal/<cli>/<period>/<rid>[.wing|.attr].json`. */
export function journalPath(root: string, cli: string, period: string, rid: string, kind = "") {
  return path.join(root, "journal", cli, period, `${rid}${kind}.json`);
}

/** Every regular file under `dir`, relative, sorted; absent directory gives an empty list. */
export function walkFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(path.relative(dir, p).split(path.sep).join("/"));
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out.sort();
}

/** `byFidelity.<fidelity>.<field>` of a `--rollup` JSON document (0 when absent). */
export function rollupFig(out: string, fidelity: string, field = "netInput"): number {
  const doc = JSON.parse(out) as {
    byFidelity?: Record<string, Record<string, number> | undefined>;
  };
  return Number(doc.byFidelity?.[fidelity]?.[field] ?? 0);
}

/** Non-empty stdout lines of a listing. */
export const listLines = (out: string): string[] => out.split("\n").filter((l) => l.length > 0);

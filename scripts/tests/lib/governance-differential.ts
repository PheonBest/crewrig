// governance-differential.ts — the two legs of a governance differential test (spec 0259 R26).
// runRealRepo: the tee-wrapped check on a sandbox of the current checkout.
// runSuiteThroughTee: the UNCHANGED Bash suite, run in a sandbox whose check is the tee stub.
// A tee divergence exits 99 and prints `governance-tee: DIVERGENCE ...`; both legs surface it.

import { spawnSync } from "node:child_process";
import path from "node:path";
import type { GovernanceCase, Tool } from "./governance-cases.ts";
import { casesOf, missingTools, type GovernanceGroup } from "./governance-cases.ts";
import { installTee, makeSandbox, runScript, type Sandbox } from "./governance-sandbox.ts";

export { casesOf, type GovernanceGroup };

export interface Transcript {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

const GIT_ID = ["-c", "user.name=gov", "-c", "user.email=gov@example.invalid"];

function git(sandbox: Sandbox, args: readonly string[]): void {
  const r = spawnSync("git", [...GIT_ID, ...args], { cwd: sandbox.root, env: sandbox.env });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${String(r.stderr)}`);
}

/** Does `tool` resolve on PATH? (A plain PATH scan: no spawned `which`.) */
export function hasTool(tool: string): boolean {
  const exts = process.platform === "win32" ? [".exe", ".cmd", ""] : [""];
  return (process.env["PATH"] ?? "")
    .split(path.delimiter)
    .some(
      (dir) =>
        dir !== "" &&
        exts.some((e) => spawnSync(path.join(dir, tool + e), ["--version"]).error === undefined),
    );
}

/**
 * Tools to skip on, or throw under CI: a missing tool must FAIL there, never silently skip.
 * Returns the missing tools (empty = run the case).
 */
export function checkNeeds(c: GovernanceCase, env: NodeJS.ProcessEnv = process.env): Tool[] {
  const missing = missingTools(c, hasTool);
  if (missing.length > 0 && env["CI"] !== undefined && env["CI"] !== "") {
    throw new Error(`${c.name}: CI is set but the host lacks ${missing.join(", ")}`);
  }
  return missing;
}

function transcript(r: { status: number | null; stdout: string; stderr: string }): Transcript {
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

function refuseDivergence(c: GovernanceCase, t: Transcript): void {
  if (t.status === 99 || t.stderr.includes("governance-tee: DIVERGENCE")) {
    throw new Error(`${c.name}: tee divergence (exit ${t.status})\n${t.stderr}${t.stdout}`);
  }
}

function missingTwin(c: GovernanceCase, t: Transcript): void {
  if (/Cannot find module|ERR_MODULE_NOT_FOUND/.test(t.stderr)) {
    throw new Error(`${c.name}: no TS twin: scripts/${c.name}.ts does not exist yet\n${t.stderr}`);
  }
}

/** Run the check through the tee on the real repository; never exit 99, never a missing twin. */
export function runRealRepo(c: GovernanceCase): Transcript {
  const sandbox = makeSandbox();
  try {
    git(sandbox, ["add", "-A"]);
    if (c.needsCommit === true) git(sandbox, ["commit", "-q", "-m", "sandbox"]);
    installTee(sandbox, c.name, { mutating: c.mutating, statusOnly: c.statusOnly });
    const t = transcript(runScript(sandbox, c.name, { args: c.realRepoArgv }));
    missingTwin(c, t);
    refuseDivergence(c, t);
    return t;
  } finally {
    sandbox.dispose();
  }
}

/** Run the unchanged Bash suite with the check replaced by the tee; it must succeed. */
export function runSuiteThroughTee(c: GovernanceCase): Transcript {
  if (c.suite === null) throw new Error(`${c.name}: has no Bash suite`);
  const sandbox = makeSandbox();
  try {
    git(sandbox, ["add", "-A"]);
    installTee(sandbox, c.name, { mutating: c.mutating, statusOnly: c.statusOnly });
    const r = spawnSync("bash", [path.join("scripts", "tests", c.suite)], {
      cwd: sandbox.root,
      env: sandbox.env,
      input: "",
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    const t = transcript(r);
    missingTwin(c, t);
    refuseDivergence(c, t);
    if (t.status !== 0)
      throw new Error(
        `${c.name}: suite ${c.suite} failed (exit ${t.status})\n${t.stdout}${t.stderr}`,
      );
    return t;
  } finally {
    sandbox.dispose();
  }
}

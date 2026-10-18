// scenario-03-skill-build.ts — TypeScript twin of scenarios/03-skill-build/run.sh (spec 0261): the
// component build runs inside the CLI image against a staged copy of the repo. Twin of the shell
// scenario: change both, and keep them equal. Env and cwd are parameters.

import fs from "node:fs";
import path from "node:path";

import { assertFileContains, assertFileExists } from "./assert.ts";
import { findOnPath, runTool } from "./exec.ts";
import { bashQuote } from "./mask_command.ts";
import { ScenarioExit, ScenarioTap, scenarioCtx, type Env } from "./scenario.ts";
import { assertStdoutMatches } from "./structural.ts";

export interface ScenarioOutcome {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

const NAME = "03-skill-build";
const TARGETS: Readonly<Record<string, { dir: string; skills: string }>> = {
  claude: { dir: ".claude", skills: ".claude/skills" },
  gemini: { dir: ".gemini", skills: ".gemini/skills" },
  copilot: { dir: ".github", skills: ".github/skills" },
};

function stringEnv(env: Env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined) out[k] = v;
  return out;
}

/** `cp -R <src> <destParent>/` tolerating every failure (`2>/dev/null || true`). */
function copyTree(src: string, dest: string, dereference: boolean): void {
  try {
    fs.cpSync(src, dest, { recursive: true, verbatimSymlinks: !dereference, dereference });
  } catch {
    // tolerated
  }
}

/** Stage a writable build tree and return the NOTE lines the shell printed on stderr. */
export function stageBuildTree(
  repoRoot: string,
  workDir: string,
  packages: readonly string[],
): string {
  let notes = "";
  fs.mkdirSync(workDir, { recursive: true });
  for (const tree of ["artifacts", "scripts", "config"]) {
    copyTree(path.join(repoRoot, tree), path.join(workDir, tree), false);
  }
  try {
    fs.copyFileSync(path.join(repoRoot, "package.json"), path.join(workDir, "package.json"));
  } catch {
    // tolerated
  }
  fs.mkdirSync(path.join(workDir, ".git"), { recursive: true });
  fs.mkdirSync(path.join(workDir, "node_modules"), { recursive: true });
  for (const pkg of packages) {
    const src = path.join(repoRoot, "node_modules", pkg);
    if (fs.existsSync(src) && fs.statSync(src).isDirectory()) {
      copyTree(src, path.join(workDir, "node_modules", pkg), true);
    } else {
      notes += `NOTE: ${repoRoot}/node_modules/${pkg} not found; staging the build tree without it\n`;
    }
  }
  return notes;
}

function buildScript(target: string, dir: string, skills: string): string {
  return [
    "set -euo pipefail",
    "cd /repo",
    `bash scripts/build-components.sh --target ${target}`,
    "manifest=/tmp/e2e-build-manifest.txt",
    `if [ -d "${dir}" ]; then`,
    `  find "${dir}" -type f | sort > "$manifest"`,
    "else",
    `  printf 'MISSING: %s\\n' "${dir}" > "$manifest"`,
    "fi",
    'cp "$manifest" /out/manifest.txt',
    "",
    "# Locate the first SKILL.md for the structural assertion.",
    `first_skill=$(find "${skills}" -name 'SKILL.md' -type f 2>/dev/null | sort | head -n1 || true)`,
    'if [ -n "$first_skill" ]; then',
    '  cp "$first_skill" /out/first-skill.md',
    "fi",
  ].join("\n");
}

function findRepoRoot(start: string): string | undefined {
  let dir = start;
  while (dir !== "/" && !fs.existsSync(path.join(dir, "scripts", "build-components.ts"))) {
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return fs.existsSync(path.join(dir, "scripts", "build-components.ts")) ? dir : undefined;
}

export function runScenario03(env: Env, cwd: string, packages: readonly string[]): ScenarioOutcome {
  let tap: ScenarioTap | undefined;
  let stderr = "";
  try {
    const ctx = scenarioCtx(env, "run.sh");
    tap = new ScenarioTap(ctx, NAME);
    const sEnv = stringEnv(env);
    const ao = { cwd, env: sEnv };
    const { cli, reportDir } = ctx;
    const target = TARGETS[cli];
    if (target === undefined) tap.skip(`unknown CLI '${cli}'`);
    const { dir: expectDir, skills } = target as { dir: string; skills: string };
    const repoRoot = findRepoRoot(ctx.scenarioDir);
    if (repoRoot === undefined) {
      tap.skip(`could not locate scripts/build-components.ts from ${ctx.scenarioDir}`);
    }
    const workDir = path.join(reportDir, "build-work");
    stderr += stageBuildTree(repoRoot as string, workDir, packages);
    const hostOut = path.join(reportDir, "out");
    fs.mkdirSync(hostOut, { recursive: true });

    const dockerArgs = [
      "run",
      "--rm",
      "--name",
      `crewrig-e2e-03-${cli}-${ctx.runId || "adhoc"}`,
      "-v",
      `${workDir}:/repo`,
      "-v",
      `${hostOut}:/out`,
      "--entrypoint",
      "bash",
      ctx.image,
      "-lc",
      buildScript(cli, expectDir, skills),
    ];
    const quoted = ["docker", ...dockerArgs].map((a) => ` ${bashQuote(a)}`).join("");
    fs.writeFileSync(
      path.join(reportDir, "invocation.txt"),
      `image: ${ctx.image}\nargv:${quoted}\n`,
    );

    const res =
      findOnPath("docker", sEnv) === null
        ? { rc: 127, stdout: "", stderr: "docker: command not found\n" }
        : runTool("docker", dockerArgs, ao);
    fs.writeFileSync(path.join(reportDir, "build.stdout"), res.stdout);
    fs.writeFileSync(path.join(reportDir, "build.stderr"), res.stderr);
    let index = 0;
    let failed = 0;
    const emit = (ok: boolean, okText: string, nokText: string): void => {
      index += 1;
      if (!ok) failed += 1;
      tap?.emit(ok ? "ok" : "not_ok", ok ? okText : nokText);
    };
    emit(
      res.rc === 0,
      "build: scripts/build-components.sh exited 0",
      "build: scripts/build-components.sh exited non-zero",
    );

    const manifest = path.join(hostOut, "manifest.txt");
    const firstSkill = path.join(hostOut, "first-skill.md");
    const a1 = assertFileExists(manifest, ao);
    stderr += a1.stderr;
    emit(
      a1.rc === 0,
      "side-effect: build manifest written to /out",
      "side-effect: build manifest missing",
    );
    const a2 = assertFileContains(manifest, `^${expectDir}/`, ao);
    stderr += a2.stderr;
    emit(
      a2.rc === 0,
      `side-effect: ${expectDir}/ populated by build`,
      `side-effect: ${expectDir}/ empty or missing`,
    );
    const a3 = assertFileContains(manifest, "SKILL\\.md$|/agents/", ao);
    stderr += a3.stderr;
    emit(
      a3.rc === 0,
      "side-effect: skills or agents emitted",
      "side-effect: no skills nor agents emitted",
    );
    if (fs.existsSync(firstSkill) && fs.statSync(firstSkill).isFile()) {
      const a4 = assertStdoutMatches("^metadata:", firstSkill, "", ao);
      stderr += a4.stderr;
      emit(
        a4.rc === 0,
        "structural: first SKILL.md carries metadata: frontmatter",
        "structural: first SKILL.md missing metadata: frontmatter",
      );
    } else {
      emit(false, "", "structural: no SKILL.md captured for inspection");
    }

    fs.appendFileSync(path.join(reportDir, "scenario.tap"), `1..${index}\n`);
    if (failed > 0) {
      tap.stdout += `${failed}/${index} FAIL — ${cli}/${NAME}\n`;
      return { status: 1, stdout: tap.stdout, stderr };
    }
    tap.stdout += `OK — ${cli}/${NAME} (${index} assertions)\n`;
    return { status: 0, stdout: tap.stdout, stderr };
  } catch (error) {
    if (error instanceof ScenarioExit) {
      return { status: error.status, stdout: tap?.stdout ?? "", stderr: stderr + error.message };
    }
    throw error;
  }
}

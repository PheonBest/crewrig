// e2e-oracle-cases-01-03.ts — oracle cases of scenarios 01-layered-context (claude, gemini,
// copilot) and 03-skill-build (the `applies_to` of tests/e2e/defaults.toml). Each scenario makes
// exactly ONE docker call (`docker run`), so every case carries one fixture, ordinal 0; the
// scenario reads its answer from the `-v <host>:/out` mount, which the fixture fills via `files`.

import fs from "node:fs";
import path from "node:path";

import type { FixtureEntry } from "./e2e-docker-standin.ts";
import type { OracleCase, SeedContext } from "./e2e-oracle-types.ts";

export const CLIS = ["claude", "gemini", "copilot"] as const;
const L01 = "01-layered-context";
const S03 = "03-skill-build";
const JUDGE_PASS = "VERDICT=PASS CONF=0.95";
const JUDGE_FAIL = "VERDICT=FAIL CONF=0.90";

/** A non-empty per-CLI bundle dir (scenario 01 skips on an empty one) plus a dummy marker. */
function seedBundle(ctx: SeedContext): void {
  const dir = path.join(ctx.e2eHome, ctx.cli);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "00-rules.md"), "# Location: Nantes\n");
  fs.writeFileSync(path.join(dir, ".credentials.json"), '{"dummy":true}\n');
}

function make(
  scenario: string,
  cli: string,
  variant: string,
  fixture: FixtureEntry | undefined,
  rest: Pick<OracleCase, "expectedExit" | "judgeMockResponse" | "seed">,
): OracleCase {
  return {
    id: `${scenario}/${cli}/${variant}`,
    scenario,
    cli,
    variant,
    fixtures: fixture === undefined ? [] : [fixture],
    ...rest,
  };
}

function layeredContext(cli: string): OracleCase[] {
  const answer = (text: string, exit = 0): FixtureEntry => ({
    match: ["run"],
    exit,
    files: { "/out/answer.txt": text },
  });
  const pass = { expectedExit: 0, judgeMockResponse: JUDGE_PASS, seed: seedBundle };
  const fail = { expectedExit: 1, judgeMockResponse: JUDGE_FAIL, seed: seedBundle };
  const out: OracleCase[] = [
    make(L01, cli, "pass", answer("Nantes\n"), pass),
    make(L01, cli, "stdout-fallback", { match: ["run"], stdout: "Nantes\n" }, pass),
    make(L01, cli, "wrong-answer", answer("Paris\n"), fail),
    make(L01, cli, "docker-fails", { match: ["run"], exit: 1, stderr: "boom\n" }, fail),
    // The runner maps the scenario's exit 78 (empty bundle dir) to a TAP skip: exit 0, no docker.
    make(L01, cli, "empty-bundle-skip", undefined, { expectedExit: 0 }),
  ];
  if (cli === "gemini") {
    out.push(
      // Recorded behaviour of the shell scenario: `_probe_rc=$?` inside `if ! cmd` reads 0, so its
      // exit-124 tolerance never fires and a 124 is reported as a failed probe (runner exit 1).
      make(L01, cli, "exit-124-with-answer", answer("Nantes\n", 124), {
        ...pass,
        expectedExit: 1,
      }),
      make(L01, cli, "exit-124-no-answer", { match: ["run"], exit: 124 }, fail),
    );
  }
  return out;
}

const BUILD: Readonly<Record<string, { dir: string; skill: string }>> = {
  claude: { dir: ".claude", skill: ".claude/skills/demo/SKILL.md" },
  gemini: { dir: ".gemini", skill: ".gemini/skills/demo/SKILL.md" },
  copilot: { dir: ".github", skill: ".github/skills/demo/SKILL.md" },
};

function skillBuild(cli: string): OracleCase[] {
  const { dir, skill } = BUILD[cli] as { dir: string; skill: string };
  const withMeta = "---\nname: demo\nmetadata:\n  provenance:\n    version: 1.0.0\n---\nBody\n";
  const run = (files: Record<string, string>, exit = 0): FixtureEntry => ({
    match: ["run"],
    exit,
    files,
  });
  const ok = { expectedExit: 0 };
  const bad = { expectedExit: 1 };
  return [
    make(
      S03,
      cli,
      "pass",
      run({ "/out/manifest.txt": `${skill}\n`, "/out/first-skill.md": withMeta }),
      ok,
    ),
    make(
      S03,
      cli,
      "build-fails",
      run({ "/out/manifest.txt": `${skill}\n`, "/out/first-skill.md": withMeta }, 1),
      bad,
    ),
    make(
      S03,
      cli,
      "no-metadata",
      run({ "/out/manifest.txt": `${skill}\n`, "/out/first-skill.md": "---\nname: demo\n---\n" }),
      bad,
    ),
    make(S03, cli, "output-dir-missing", run({ "/out/manifest.txt": `MISSING: ${dir}\n` }), bad),
  ];
}

export const cases: OracleCase[] = [...CLIS.flatMap(layeredContext), ...CLIS.flatMap(skillBuild)];

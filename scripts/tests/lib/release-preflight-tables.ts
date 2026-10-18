// release-preflight-tables.ts — the input tables shared by the monorepo release preflight suites
// and the differential run against the shell library (spec 0257 R13, R18).

import { ReleaseRefusal } from "../../lib/monorepo-release/refusal.ts";

/** A predicate for assert.throws: a ReleaseRefusal with exactly this message. */
export function refusal(message: string): (error: unknown) => boolean {
  return (error) => error instanceof ReleaseRefusal && error.message === message;
}

export const CREDENTIAL_NAMES: Array<[string, boolean]> = [
  ["GITHUB_TOKEN", true],
  ["GITLAB_TOKEN", true],
  ["GH_TOKEN", true],
  ["RELEASE_TOKEN", true],
  ["github_token", true],
  ["MyPassword", true],
  ["DB_PASSWORD", true],
  ["AWS_CREDENTIALS", true],
  ["CLIENT_SECRET", true],
  ["SSH_PRIVATE_KEY", true],
  ["CI_JOB_TOKEN", true],
  ["CI_REPOSITORY_URL", true],
  ["ci_repository_url", true],
  ["Ci_Repository_Url", true],
  ["CI_REPOSITORY_URL_X", false],
  ["CI_PROJECT_URL", false],
  ["PATH", false],
  ["HOME", false],
  ["GITHUB_REPOSITORY", false],
  ["GIT_AUTHOR_NAME", false],
  ["NODE_PATH", false],
  ["", false],
];

export const STEP = (type: string, plugin: string): string =>
  `[1:00] ✖  Failed step "${type}" of plugin "${plugin}"`;
export const FAILED_LOGS: Array<[string, string, string]> = [
  ["no marker", "all good\nnothing failed", "engine"],
  ["empty log", "", "engine"],
  ["exec prepare", STEP("prepare", "@semantic-release/exec"), "package"],
  ["git prepare", STEP("prepare", "@semantic-release/git"), "commit"],
  ["github publish", STEP("publish", "@semantic-release/github"), "release"],
  [
    "gitlab publish, package API",
    `${STEP("publish", "@semantic-release/gitlab")}\nGitLab generics package API said no`,
    "upload",
  ],
  [
    "gitlab publish, release API",
    `${STEP("publish", "@semantic-release/gitlab")}\nGitLab release API said no`,
    "release",
  ],
  [
    "gitlab publish, both texts: upload wins",
    `GitLab release API\nGitLab generics package API\n${STEP("publish", "@semantic-release/gitlab")}`,
    "upload",
  ],
  ["gitlab publish, no text", STEP("publish", "@semantic-release/gitlab"), "engine"],
  ["verifyConditions any plugin", STEP("verifyConditions", "@semantic-release/anything"), "verify"],
  ["unknown step", STEP("analyzeCommits", "foo"), "engine"],
  ["unknown plugin for prepare", STEP("prepare", "other"), "engine"],
  [
    "first marker wins",
    `${STEP("prepare", "@semantic-release/exec")}\n${STEP("prepare", "@semantic-release/git")}`,
    "package",
  ],
  ["marker without plugin", 'Failed step "prepare"', "engine"],
  [
    "last pair on a line wins",
    `${STEP("verifyConditions", "x")} ${STEP("prepare", "@semantic-release/git")}`,
    "commit",
  ],
];

export const TAG_LOGS: Array<[string, string, string]> = [
  ["none", "nothing here", ""],
  ["empty", "", ""],
  ["simple", "[1] ✔ Created tag ext-v1.2.3", "ext-v1.2.3"],
  ["first line wins", "Created tag a-v1\nCreated tag b-v2", "a-v1"],
  ["last occurrence on the line", "Created tag a-v1 and Created tag b-v2 end", "b-v2"],
  ["tag followed by text", "Created tag ext-v1.0.0 on branch main", "ext-v1.0.0"],
  ["fetched tag is not created", "Fetching tag ext-v0.9.0\nPushed tag ext-v0.9.0", ""],
  ["trailing space gives an empty tag", "Created tag ", ""],
];

export const SEMVER_TABLE: Array<[string, boolean]> = [
  ["0.0.0", true],
  ["1.2.3", true],
  ["10.20.30", true],
  ["1.2.3-alpha.1", true],
  ["1.2.3+build.5", true],
  ["1.2.3-rc.1+meta-x", true],
  ["01.2.3", false],
  ["1.02.3", false],
  ["1.2", false],
  ["1.2.3.4", false],
  ["v1.2.3", false],
  ["1.2.3-", false],
  ["1.2.3 ", false],
  ["", false],
  ["1.2.3\n", false],
];

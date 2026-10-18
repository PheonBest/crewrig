// e2e-oracle-libs-cases-auth.ts — library cases of scripts/e2e/lib/auth-common.sh (spec 0261 R9,
// PLAN v3 PR 2, Table 1: test-e2e-auth-common and test-e2e-auth-ready). The bundle root is
// `{WORK}/h/.crewrig-e2e`, selected through CREWRIG_E2E_HOME, so every seed lands where the
// library looks. Cases that print the in-process label rely on the `printVars` field of LibCase.

import type { LibCase, LibSeedFile } from "./e2e-oracle-libs-types.ts";

const LIB = "scripts/e2e/lib/auth-common.sh";
const ROOT = "h/.crewrig-e2e";
const HOME_ENV = { CREWRIG_E2E_HOME: "{WORK}/h" };

const mk = (id: string, fn: string, rest: Partial<LibCase> = {}): LibCase => ({
  id: `auth-common/${id}`,
  lib: LIB,
  fn,
  forbidDockerRun: true,
  ...rest,
});
const bundle = (rel: string, content = '{"placeholder":"x"}\n', mode?: number): LibSeedFile =>
  mode === undefined
    ? { path: `${ROOT}/${rel}`, content }
    : { path: `${ROOT}/${rel}`, content, mode };

const ready = (
  id: string,
  cli: string,
  env: Record<string, string> = {},
  seed: LibSeedFile[] = [],
) =>
  mk(`auth-ready-${id}`, "e2e_auth_ready", {
    args: [cli],
    env: { ...HOME_ENV, ...env },
    seed,
    printVars: ["E2E_AUTH_READY_CREDENTIAL_PATH"],
  });

const helpers: LibCase[] = [
  mk("die", "e2e_die", { args: ["boom", "twice"] }),
  mk("skip", "e2e_skip", { args: ["not", "configured"] }),
  mk("info", "e2e_info", { args: ["hello", "world"] }),
  mk("info-empty", "e2e_info"),
  mk("require-docker", "e2e_require_docker"),
  mk("require-image-present", "e2e_require_image", {
    args: ["crewrig-e2e:test", "task e2e:build"],
  }),
  mk("require-image-missing", "e2e_require_image", {
    args: ["crewrig-e2e:test", "task e2e:build"],
    env: { E2E_STANDIN_MISSING_IMAGES: "crewrig-e2e:test" },
  }),
  mk("require-image-other-missing", "e2e_require_image", {
    args: ["crewrig-e2e:test", "task e2e:build"],
    env: { E2E_STANDIN_MISSING_IMAGES: "other:tag" },
  }),
  mk("e2e-home-override", "e2e_e2e_home", { env: HOME_ENV }),
  mk("e2e-home-default", "e2e_e2e_home"),
  mk("e2e-home-empty-override", "e2e_e2e_home", { env: { CREWRIG_E2E_HOME: "" } }),
  ...["claude", "gemini", "copilot", "ollama"].map((cli) =>
    mk(`cli-dir-${cli}`, "e2e_cli_dir", { args: [cli], env: HOME_ENV }),
  ),
  mk("cli-dir-default-home", "e2e_cli_dir", { args: ["claude"] }),
];

// POSIX only: the chmod-based cases below depend on the file mode bits the tuple records.
const bootstrapCases: LibCase[] = [
  // The target directory's own mode (a+rwx) is not in the tuple: only the exit code, the info
  // line and the absence of any `docker run` (the stand-in exits 99 on one) are observed.
  mk("chown-bootstrap-existing-dir", "e2e_chown_bootstrap", {
    args: ["claude", "crewrig-e2e:test"],
    env: HOME_ENV,
    seed: [bundle("claude/keep", "k\n", 0o600)],
  }),
  mk("chown-bootstrap-absent-dir", "e2e_chown_bootstrap", {
    args: ["gemini", "crewrig-e2e:test"],
    env: HOME_ENV,
  }),
  mk("ensure-bundle-dir-fresh", "e2e_ensure_bundle_dir", { args: ["copilot"], env: HOME_ENV }),
  mk("ensure-bundle-dir-existing", "e2e_ensure_bundle_dir", {
    args: ["claude"],
    env: HOME_ENV,
    seed: [bundle("claude/.credentials.json", "{}\n", 0o600)],
  }),
  mk("ensure-bundle-dir-no-home-root", "e2e_ensure_bundle_dir", {
    args: ["gemini"],
    env: { CREWRIG_E2E_HOME: "{WORK}/a/b" },
  }),
  mk("assert-bundle-modes-corrects", "e2e_assert_bundle_modes", {
    args: ["claude"],
    env: HOME_ENV,
    seed: [
      bundle("claude/.credentials.json", "{}\n", 0o644),
      bundle("claude/sub/deep/notes.txt", "n\n", 0o755),
      bundle("claude/sub/other.json", "{}\n", 0o666),
    ],
  }),
  mk("assert-bundle-modes-idempotent", "e2e_assert_bundle_modes", {
    args: ["gemini"],
    env: HOME_ENV,
    seed: [bundle("gemini/oauth_creds.json", "{}\n", 0o600)],
  }),
  mk("assert-bundle-modes-no-dir", "e2e_assert_bundle_modes", { args: ["copilot"], env: HOME_ENV }),
  mk("assert-bundle-modes-ignores-sibling", "e2e_assert_bundle_modes", {
    args: ["claude"],
    env: HOME_ENV,
    seed: [bundle("claude/a", "a\n", 0o644), bundle("gemini/b", "b\n", 0o644)],
  }),
];

// Directory modes are part of the contract: record the bundle root, the per-CLI directory and, for
// the assert cases, the nested directory, as `statPaths` relative to work/.
const withStats = (c: LibCase): LibCase => {
  const base = (c.env?.CREWRIG_E2E_HOME ?? "").replace("{WORK}/", "");
  const cli = c.args?.[0] ?? "";
  const nested = c.id.includes("corrects") ? [`${base}/.crewrig-e2e/${cli}/sub/deep`] : [];
  return {
    ...c,
    statPaths: [`${base}/.crewrig-e2e`, `${base}/.crewrig-e2e/${cli}`, ...nested],
  };
};
const bootstrap = bootstrapCases.map(withStats);

const tokenEnv = (name: string): Record<string, string> => ({ [name]: "test" });
const authReady: LibCase[] = [
  ...["claude", "gemini", "copilot"].map((cli) => ready(`clean-${cli}`, cli)),
  ready("claude-api-key", "claude", tokenEnv("ANTHROPIC_API_KEY")),
  ready("gemini-api-key", "gemini", tokenEnv("GEMINI_API_KEY")),
  ready("claude-empty-api-key", "claude", { ANTHROPIC_API_KEY: "" }),
  ready("copilot-token", "copilot", tokenEnv("COPILOT_GITHUB_TOKEN")),
  ready("copilot-gh-token", "copilot", tokenEnv("GH_TOKEN")),
  ready("copilot-token-beats-gh-token", "copilot", {
    COPILOT_GITHUB_TOKEN: "primary",
    GH_TOKEN: "fallback",
  }),
  ready("claude-marker", "claude", {}, [bundle("claude/.credentials.json")]),
  ready("claude-marker-beats-key", "claude", tokenEnv("ANTHROPIC_API_KEY"), [
    bundle("claude/.credentials.json"),
  ]),
  ready("claude-empty-marker", "claude", {}, [bundle("claude/.credentials.json", "")]),
  ready("gemini-marker", "gemini", {}, [bundle("gemini/oauth_creds.json")]),
  ready("copilot-config", "copilot", {}, [bundle("copilot/config.json")]),
  ready("copilot-config-plus-token", "copilot", tokenEnv("COPILOT_GITHUB_TOKEN"), [
    bundle("copilot/config.json"),
  ]),
  ready("copilot-empty-config", "copilot", {}, [bundle("copilot/config.json", "")]),
  ready("copilot-ollama-keypair", "copilot", {}, [bundle("ollama/id_ed25519", "fake-key\n")]),
  ready("copilot-config-beats-keypair", "copilot", {}, [
    bundle("copilot/config.json"),
    bundle("ollama/id_ed25519", "fake-key\n"),
  ]),
  ready("copilot-empty-keypair", "copilot", {}, [bundle("ollama/id_ed25519", "")]),
  ready("unknown-cli", "nonesuch"),
  ready("no-argument-cli-empty", ""),
];

export const cases: LibCase[] = [...helpers, ...bootstrap, ...authReady];

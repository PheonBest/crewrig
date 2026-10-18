// e2e-auth-differential.test.ts — the four auth entries through their TypeScript leg in a sandbox with the
// Docker stand-in first on PATH (spec 0261 R10). The shell leg is removed with the auth-*.sh shims.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { entryExists, runEntry, type EntryBox, type EntryCase } from "./lib/e2e-entry-diff.ts";

function put(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

const rules = (b: EntryBox) => {
  put(path.join(b.home, ".claude/rules/00-soul.md"), "# soul\n");
  put(path.join(b.home, ".claude/rules/10-level.md"), "# level\n");
  put(path.join(b.home, ".claude/rules/notes.txt"), "ignored\n");
};
const instructions = (b: EntryBox) => {
  put(path.join(b.home, ".copilot/instructions/00-a.instructions.md"), "a\n");
  put(path.join(b.home, ".copilot/instructions/10-b.instructions.md"), "b\n");
  put(path.join(b.home, ".copilot/instructions/skip.md"), "c\n");
};
const cfg = (b: EntryBox) => put(path.join(b.home, ".copilot/config.json"), '{"t":"x"}\n');

const C = "/home/agent/.claude";
const G = "/home/agent/.gemini";
const O = "/home/agent/.ollama";

const claudeOk = { [`${C}/.credentials.json`]: '{"oauth":"x"}\n', [`${C}/.claude.json`]: "{}\n" };
const geminiOk = { [`${G}/oauth_creds.json`]: '{"r":"x"}\n', [`${G}/settings.json`]: "{}\n" };
const ollamaOk = { [`${O}/id_ed25519`]: "PRIVATE\n", [`${O}/id_ed25519.pub`]: "PUBLIC\n" };

const noDocker = !(fs.existsSync("/usr/bin/docker") || fs.existsSync("/bin/docker"));
const bare = { PATH: "/usr/bin:/bin" };

const cases: EntryCase[] = [
  {
    id: "claude-ok",
    file: "scripts/e2e/auth-claude",
    seed: rules,
    fixtures: [{ files: claudeOk }],
  },
  {
    id: "claude-ok-preexisting",
    file: "scripts/e2e/auth-claude",
    seed: (b) => {
      rules(b);
      put(path.join(b.e2eHome, "claude/rules/old.md"), "old\n");
      put(path.join(b.e2eHome, "claude/.claude.json"), "{}\n");
    },
    fixtures: [{ files: claudeOk }],
  },
  {
    id: "claude-image-missing",
    file: "scripts/e2e/auth-claude",
    seed: rules,
    missingImages: ["crewrig/e2e-claude:latest"],
  },
  { id: "claude-no-rules-dir", file: "scripts/e2e/auth-claude", fixtures: [{ files: claudeOk }] },
  {
    id: "claude-empty-rules-dir",
    file: "scripts/e2e/auth-claude",
    seed: (b) => fs.mkdirSync(path.join(b.home, ".claude/rules"), { recursive: true }),
  },
  {
    id: "claude-docker-fails",
    file: "scripts/e2e/auth-claude",
    seed: rules,
    fixtures: [{ exit: 3 }],
  },
  {
    id: "claude-missing-credentials",
    file: "scripts/e2e/auth-claude",
    seed: rules,
    fixtures: [{ files: { [`${C}/.claude.json`]: "{}\n" } }],
  },
  {
    id: "claude-api-key-on-disk",
    file: "scripts/e2e/auth-claude",
    seed: rules,
    fixtures: [
      { files: { ...claudeOk, [`${C}/.credentials.json`]: '{"ANTHROPIC_API_KEY":"k"}\n' } },
    ],
  },
  ...(noDocker
    ? [{ id: "claude-no-docker", file: "scripts/e2e/auth-claude", seed: rules, env: bare }]
    : []),

  {
    id: "gemini-ok",
    file: "scripts/e2e/auth-gemini",
    seed: (b) => {
      const d = path.join(b.e2eHome, "gemini");
      put(path.join(d, "antigravity/x"), "1");
      put(path.join(d, "antigravity-browser-profile/x"), "1");
      put(path.join(d, "tmp/y"), "1");
      put(path.join(d, "a.bak"), "1");
      put(path.join(d, "sub/b.orig"), "1");
      put(path.join(d, "sub/deep/c.ori"), "keep (depth 3)");
      put(path.join(d, "sub/keep.txt"), "keep");
    },
    fixtures: [{ files: geminiOk }],
  },
  {
    id: "gemini-image-missing",
    file: "scripts/e2e/auth-gemini",
    missingImages: ["crewrig/e2e-gemini:latest"],
  },
  { id: "gemini-docker-fails", file: "scripts/e2e/auth-gemini", fixtures: [{ exit: 2 }] },
  {
    id: "gemini-missing-settings",
    file: "scripts/e2e/auth-gemini",
    fixtures: [{ files: { [`${G}/oauth_creds.json`]: "{}\n" } }],
  },
  {
    id: "gemini-api-key-material",
    file: "scripts/e2e/auth-gemini",
    fixtures: [
      { files: { ...geminiOk, [`${G}/extra/env.txt`]: "GEMINI_API_KEY = abcdefghijklmnop1234\n" } },
    ],
  },
  {
    id: "gemini-prose-and-short-value-ok",
    file: "scripts/e2e/auth-gemini",
    fixtures: [
      {
        files: {
          ...geminiOk,
          [`${G}/notes.txt`]: "set GOOGLE_API_KEY in your shell\nGOOGLE_API_KEY=short\n",
        },
      },
    ],
  },
  ...(noDocker ? [{ id: "gemini-no-docker", file: "scripts/e2e/auth-gemini", env: bare }] : []),

  { id: "ollama-ok", file: "scripts/e2e/auth-ollama", fixtures: [{ files: ollamaOk }] },
  {
    id: "ollama-image-missing",
    file: "scripts/e2e/auth-ollama",
    missingImages: ["crewrig/e2e-copilot:latest"],
  },
  { id: "ollama-docker-fails", file: "scripts/e2e/auth-ollama", fixtures: [{ exit: 5 }] },
  {
    id: "ollama-missing-pub",
    file: "scripts/e2e/auth-ollama",
    fixtures: [{ files: { [`${O}/id_ed25519`]: "PRIVATE\n" } }],
  },
  {
    id: "ollama-missing-both",
    file: "scripts/e2e/auth-ollama",
    fixtures: [{}],
  },
  {
    id: "ollama-api-key-file",
    file: "scripts/e2e/auth-ollama",
    fixtures: [{ files: { ...ollamaOk, [`${O}/sub/My_API_Key.txt`]: "k\n" } }],
  },

  {
    id: "copilot-no-token",
    file: "scripts/e2e/auth-copilot",
    seed: (b) => {
      instructions(b);
      cfg(b);
    },
    forbidRun: true,
  },
  {
    id: "copilot-no-token-no-config",
    file: "scripts/e2e/auth-copilot",
    seed: instructions,
    forbidRun: true,
  },
  { id: "copilot-no-instructions-dir", file: "scripts/e2e/auth-copilot", forbidRun: true },
  {
    id: "copilot-empty-instructions-dir",
    file: "scripts/e2e/auth-copilot",
    seed: (b) => fs.mkdirSync(path.join(b.home, ".copilot/instructions"), { recursive: true }),
  },
  {
    id: "copilot-token-ok",
    file: "scripts/e2e/auth-copilot",
    seed: (b) => {
      instructions(b);
      cfg(b);
    },
    env: { COPILOT_GITHUB_TOKEN: "ghp_abcdefghijklmnop" },
    fixtures: [{ match: ["run", "--rm", "-e", "COPILOT_GITHUB_TOKEN"] }],
  },
  {
    id: "copilot-token-image-missing",
    file: "scripts/e2e/auth-copilot",
    seed: instructions,
    env: { COPILOT_GITHUB_TOKEN: "ghp_abcdefghijklmnop" },
    missingImages: ["crewrig/e2e-copilot:latest"],
  },
  {
    id: "copilot-token-sanity-fails",
    file: "scripts/e2e/auth-copilot",
    seed: instructions,
    env: { COPILOT_GITHUB_TOKEN: "ghp_abcdefghijklmnop" },
    fixtures: [{ exit: 1 }],
  },
  ...(noDocker
    ? [
        {
          id: "copilot-token-no-docker",
          file: "scripts/e2e/auth-copilot",
          seed: instructions,
          env: { ...bare, COPILOT_GITHUB_TOKEN: "ghp_abcdefghijklmnop" },
        },
      ]
    : []),
];

describe("e2e auth entries: TypeScript entries", () => {
  const probe = (id: string) => cases.find((c) => c.id === id) as EntryCase;
  it(
    "claude success path prints the marker lines the shell suites rely on",
    { skip: !entryExists(cases[0] as EntryCase, "entry") },
    () => {
      const t = runEntry(probe("claude-ok"), "entry");
      assert.ok(t !== null);
      assert.equal(t.rc, 0);
      assert.match(t.stderr, /Authenticated\. Credentials persisted under/);
      assert.ok(
        t.dockerCalls.some((a) => a.join(" ").includes(".claude.json:/home/agent/.claude.json")),
      );
    },
  );
  it(
    "copilot no-token guidance carries the PAT URL, export hint and 90 days",
    { skip: !entryExists(cases[0] as EntryCase, "entry") },
    () => {
      const t = runEntry(probe("copilot-no-token"), "entry");
      assert.ok(t !== null);
      assert.equal(t.rc, 0);
      assert.match(t.stderr, /github\.com\/settings\/personal-access-tokens\/new/);
      assert.match(t.stderr, /export COPILOT_GITHUB_TOKEN/);
      assert.match(t.stderr, /90 DAYS/);
    },
  );
  it(
    "missing image names the build hint",
    { skip: !entryExists(cases[0] as EntryCase, "entry") },
    () => {
      const t = runEntry(probe("gemini-image-missing"), "entry");
      assert.ok(t !== null);
      assert.equal(t.rc, 1);
      assert.match(t.stderr, /task e2e:build:gemini/);
    },
  );
});

// e2e-auth-mounts.test.ts — migrated from test-e2e-auth-claude-json.sh (issue #112) and
// test-e2e-auth-ollama.sh (issue #114, #1107); spec 0261 R19. Runs the TypeScript auth scripts
// against the Docker stand-in with a scratch HOME and reads the `-v` binds of the recorded
// `docker run`; the TOML half parses the committed defaults.

import assert from "node:assert/strict";
import path from "node:path";
import { after, describe, it } from "node:test";

import {
  dockerRunBinds,
  makeScratch,
  put,
  readToml,
  REPO,
  runEntry,
  sandboxEnv,
  slashed,
} from "./lib/e2e-suite-kit.ts";

const s = makeScratch("crewrig-e2e-auth-mounts");
after(() => s.cleanup());

function authRun(cli: "claude" | "ollama", fixture: object) {
  const e2e = path.join(s.root, `e2e-${cli}`);
  const fixtures = path.join(s.root, `fixtures-${cli}.json`);
  const log = path.join(s.root, `docker-${cli}.log`);
  put(fixtures, JSON.stringify({ [`auth/${cli}`]: [fixture] }));
  put(log, "");
  put(path.join(s.home, ".claude/rules/00-test.md"), "rule\n");
  const env = sandboxEnv(s, {
    CREWRIG_E2E_HOME: e2e,
    E2E_STANDIN_FIXTURES: fixtures,
    E2E_STANDIN_CASE: `auth/${cli}`,
    E2E_STANDIN_LOG: log,
  });
  const r = runEntry(path.join(REPO, "scripts/e2e", `auth-${cli}.ts`), [], env);
  return { r, binds: dockerRunBinds(log).map(slashed), e2e: slashed(e2e) };
}

const mountsOf = (cfg: Record<string, unknown>, cli: string): string[] => {
  const c = (cfg["cli"] as Record<string, Record<string, unknown>> | undefined)?.[cli];
  return (c?.["mounts"] as string[] | undefined) ?? [];
};

describe("auth-claude binds .claude.json (issue #112)", () => {
  it("docker run binds .claude.json into /home/agent/.claude.json", () => {
    const { r, binds, e2e } = authRun("claude", {
      files: { "/home/agent/.claude/.credentials.json": "{}", "/home/agent/.claude.json": "{}" },
    });
    assert.equal(r.status, 0, r.out);
    assert.ok(
      binds.includes(`${e2e}/.crewrig-e2e/claude/.claude.json:/home/agent/.claude.json`),
      binds.join(" "),
    );
  });

  it("[cli.claude].mounts in defaults.toml targets /home/agent/.claude.json", () => {
    const mounts = mountsOf(readToml("tests/e2e/defaults.toml"), "claude");
    assert.ok(
      mounts.some((m) => /\/home\/agent\/\.claude\.json(:|$)/.test(m)),
      JSON.stringify(mounts),
    );
  });
});

describe("auth-ollama binds .ollama (issue #114)", () => {
  it("docker run binds the host path into /home/agent/.ollama", () => {
    const { r, binds, e2e } = authRun("ollama", {
      files: {
        "/home/agent/.ollama/id_ed25519": "key",
        "/home/agent/.ollama/id_ed25519.pub": "pub",
      },
    });
    assert.equal(r.status, 0, r.out);
    assert.ok(binds.includes(`${e2e}/.crewrig-e2e/ollama:/home/agent/.ollama`), binds.join(" "));
  });

  it("local.toml.example gets the keypair to a writable ~/.ollama (direct mount or copy-into-writable, #1107)", () => {
    const cfg = readToml("tests/e2e/local.toml.example");
    const copilot = (cfg["cli"] as Record<string, Record<string, unknown>>)["copilot"] ?? {};
    const mounts = (copilot["mounts"] as string[] | undefined) ?? [];
    const command = JSON.stringify(copilot["command"] ?? []);
    const direct = mounts.some((m) => /\/home\/agent\/\.ollama(:|$)/.test(m));
    const copy = mounts.length > 0 && command.includes("~/.ollama") && /cp\s/.test(command);
    assert.ok(direct || copy, `mounts=${JSON.stringify(mounts)} command=${command}`);
  });
});

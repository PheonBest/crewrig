// monorepo-release-blackbox-flows2.test.ts — the GitLab publish outcomes of the real release driver
// (the failed-step mapping, the incomplete tag, the published archive) and case 11g of spec 0257
// R22 (the release note of the golden GitHub configuration and of the one the driver emits are
// byte-identical), from the outside. The engine is the capturing `npx` stub, except in 11g, where
// the real rehearsal helper renders the note. Every assertion is leg-agnostic.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import { REPO } from "./lib/build-fixture-tree.ts";
import {
  GITHUB_PUBLISH,
  GITLAB_PUBLISH,
  manifestVersion,
  startForgeStub,
} from "./lib/release-flow-support.ts";
import { forEachLeg } from "./lib/release-blackbox-legs.ts";
import { createReleaseSandbox } from "./lib/release-driver-sandbox.ts";

const FIXTURES = path.join(REPO, "scripts", "tests", "fixtures", "release");
const SIX = ["second-ext", "third-ext", "fourth-ext", "fifth-ext", "sixth-ext"].map((name) => ({
  name,
  version: "0.4.0",
}));

function failing(step: string, plugin: string, ...more: string[]) {
  return { lines: [`Failed step "${step}" of plugin "${plugin}"`, ...more], status: 1 };
}

describe("monorepo release driver, black box: GitLab publish outcomes", () => {
  forEachLeg((leg) => {
    it(`[${leg}] rb-g-gitlab-failed-step: each failing engine step is named`, () => {
      const sb = createReleaseSandbox({ extraExtensions: SIX });
      try {
        sb.scriptNpx({
          "hello-world": failing("prepare", "@semantic-release/exec"),
          "second-ext": failing(
            "publish",
            "@semantic-release/gitlab",
            "Error: GitLab generics package API said no",
          ),
          "third-ext": failing("publish", "@semantic-release/gitlab", "GitLab release API failed"),
          "fourth-ext": failing("verifyConditions", "@semantic-release/gitlab"),
          "fifth-ext": failing("prepare", "@semantic-release/git"),
          "sixth-ext": { lines: ["an error without a step"], status: 1 },
        });
        const res = sb.run(leg, GITLAB_PUBLISH);
        const lines = res.stdout.split("\n");
        assert.equal(res.status, 1, res.stdout + res.stderr);
        for (const [ext, step] of [
          ["hello-world", "package"],
          ["second-ext", "upload"],
          ["third-ext", "release"],
          ["fourth-ext", "verify"],
          ["fifth-ext", "commit"],
          ["sixth-ext", "engine"],
        ]) {
          assert.ok(lines.includes(`RELEASE-FAILED ${ext} step=${step}`), `${ext}: ${res.stdout}`);
        }
        assert.equal(lines.filter((l) => l.startsWith("RELEASE-FAILED ")).length, 6);
        assert.ok(!lines.some((l) => l.startsWith("RELEASE-INCOMPLETE-TAG")));
        assert.ok(lines.includes("Release analysis completed WITH ERRORS."));
        assert.equal(sb.readJsonl("npx").length, 6, "one engine run per extension");
        assert.deepEqual(sb.readJsonl("rehearse"), [], "GitLab publish never rehearses");
      } finally {
        sb.dispose();
      }
    });

    it(`[${leg}] rb-g-gitlab-created-tag: a failing run that created a tag reports it`, () => {
      const sb = createReleaseSandbox();
      try {
        sb.scriptNpx({
          "hello-world": {
            lines: [
              "Created tag hello-world-v1.3.0",
              'Failed step "publish" of plugin "@semantic-release/gitlab"',
              "GitLab generics package API failed",
            ],
            status: 1,
          },
        });
        const res = sb.run(leg, GITLAB_PUBLISH);
        const lines = res.stdout.split("\n");
        assert.equal(res.status, 1, res.stdout + res.stderr);
        const failed = lines.indexOf("RELEASE-FAILED hello-world step=upload");
        assert.ok(failed >= 0, res.stdout);
        assert.equal(lines[failed + 1], "RELEASE-INCOMPLETE-TAG hello-world-v1.3.0");
        assert.ok(lines.includes("UNCHANGED second-ext"));
        assert.ok(!lines.some((l) => l.startsWith("PUBLISHED ")));
        assert.equal(sb.readJsonl("npx").length, 2);
      } finally {
        sb.dispose();
      }
    });

    it(`[${leg}] rb-g-gitlab-published: a created tag publishes its archive, the rest is unchanged`, () => {
      const sb = createReleaseSandbox();
      try {
        const archive = "hello-world-1.3.0.tar.gz";
        sb.scriptNpx({
          "hello-world": {
            lines: ["Created tag hello-world-v1.3.0"],
            status: 0,
            archive,
          },
        });
        const res = sb.run(leg, GITLAB_PUBLISH);
        const lines = res.stdout.split("\n");
        assert.equal(res.status, 0, res.stdout + res.stderr);
        const sha = createHash("sha256").update("archive of hello-world\n").digest("hex");
        assert.ok(
          lines.includes(
            `PUBLISHED hello-world tag=hello-world-v1.3.0 archive=${archive} sha256=${sha}`,
          ),
          res.stdout,
        );
        assert.ok(lines.includes("UNCHANGED second-ext"));
        assert.ok(lines.includes("Release analysis completed successfully."));
        assert.equal(sb.readJsonl("npx").length, 2);
        assert.equal(fs.existsSync(path.join(sb.root, "dist")), false, "dist/ is cleaned up");
      } finally {
        sb.dispose();
      }
    });
  });
});

const hasEngine = fs.existsSync(path.join(REPO, "node_modules", "semantic-release"));
const live: string[] = [];
after(() => {
  for (const dir of live) fs.rmSync(dir, { recursive: true, force: true });
});

function run(cmd: string, args: string[], cwd: string, env: Record<string, string>) {
  const res = spawnSync(cmd, args, { cwd, env, encoding: "utf8" });
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(" ")}: ${res.stderr}${res.stdout}`);
  return res.stdout;
}

/** Replace `from` by `to` in every string of a JSON value. */
function mapStrings(value: unknown, mapper: (s: string) => string): unknown {
  if (typeof value === "string") return mapper(value);
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, mapper));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapStrings(v, mapper)]));
  }
  return value;
}

/** The publish leg is removed, as the shell suite does: a dry run must not need the forge. */
function withoutPublishLeg(config: Record<string, unknown>): Record<string, unknown> {
  const plugins = (config["plugins"] as unknown[]).filter(
    (p) => !(Array.isArray(p) && p[0] === "@semantic-release/github"),
  );
  return { ...config, plugins };
}

describe("monorepo release driver, black box: 11g GitHub release note", () => {
  forEachLeg((leg) => {
    it(
      `[${leg}] rb-11g-release-note: the golden and the emitted configuration render the same note`,
      { skip: hasEngine ? false : "semantic-release is not installed in node_modules" },
      async () => {
        // 1. The GitHub publish configuration, as the driver emits it for the extension `foo`.
        const sb = createReleaseSandbox({ extraExtensions: [{ name: "foo", version: "1.2.0" }] });
        const stub = await startForgeStub();
        let emitted: Record<string, unknown>;
        try {
          sb.scriptRehearse({
            "hello-world": { released: false },
            foo: { released: true, version: "1.2.0", gitTag: "foo-v1.2.0" },
          });
          sb.scriptNpx({ foo: ["Created tag foo-v1.2.0"] });
          const res = sb.run(leg, { ...GITHUB_PUBLISH, GITHUB_API_URL: stub.apiUrl });
          assert.equal(res.status, 0, res.stdout + res.stderr);
          const calls = sb.readJsonl("npx");
          assert.equal(calls.length, 1, "the publish run reached the engine once");
          assert.equal(calls[0]?.["ext"], "foo");
          const raw = String(calls[0]?.["extendsContent"]);
          assert.ok(raw.includes(sb.root), "the emitted configuration names the checkout paths");
          emitted = JSON.parse(
            raw
              .split(`${sb.root}/scripts/lib/`)
              .join("/ROOT/scripts/lib/")
              .split(sb.root)
              .join("/ROOT"),
          ) as Record<string, unknown>;
          assert.ok(manifestVersion(sb, "foo") === "1.2.0");
        } finally {
          stub.stop();
          sb.dispose();
        }

        // 2. A hermetic repository: a baseline tag, one feature commit, a local origin.
        const aux = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "release-11g-")));
        live.push(aux);
        const fixture = path.join(aux, "repo");
        const origin = path.join(aux, "origin.git");
        const home = path.join(aux, "home");
        fs.mkdirSync(home);
        const gitconfig = path.join(home, "gitconfig");
        fs.writeFileSync(
          gitconfig,
          `[url "${origin}"]\n\tinsteadOf = https://origin.fixture.invalid/acme/fixture.git\n`,
        );
        const env = {
          PATH: process.env["PATH"] ?? "",
          HOME: home,
          GIT_CONFIG_GLOBAL: gitconfig,
          GIT_CONFIG_SYSTEM: os.devNull,
          GIT_AUTHOR_NAME: "Fixture",
          GIT_AUTHOR_EMAIL: "fixture@example.invalid",
          GIT_COMMITTER_NAME: "Fixture",
          GIT_COMMITTER_EMAIL: "fixture@example.invalid",
        };
        const ext = path.join(fixture, "extensions", "core", "foo");
        fs.mkdirSync(ext, { recursive: true });
        fs.writeFileSync(
          path.join(ext, "package.json"),
          '{"name":"foo-extension","version":"1.2.0"}\n',
        );
        fs.writeFileSync(path.join(ext, "CONTEXT.md"), "context\n");
        fs.writeFileSync(path.join(fixture, ".gitignore"), "node_modules/\n");
        fs.symlinkSync(path.join(REPO, "node_modules"), path.join(fixture, "node_modules"));
        run("git", ["init", "-q", "-b", "main", origin, "--bare"], aux, env);
        run("git", ["init", "-q", "-b", "main"], fixture, env);
        run("git", ["add", "-A"], fixture, env);
        run("git", ["commit", "-q", "-m", "chore: init"], fixture, env);
        run("git", ["tag", "foo-v1.2.0"], fixture, env);
        fs.appendFileSync(path.join(ext, "CONTEXT.md"), "// feature\n");
        run("git", ["commit", "-q", "-am", ":sparkles: add foo feature (#12)"], fixture, env);
        run(
          "git",
          ["remote", "add", "origin", "https://origin.fixture.invalid/acme/fixture.git"],
          fixture,
          env,
        );
        run("git", ["push", "-q", "origin", "main", "--tags"], fixture, env);

        // 3. Render the note once per configuration, with the REAL rehearsal helper.
        const golden = JSON.parse(
          fs.readFileSync(path.join(FIXTURES, "github-releaserc.golden.json"), "utf8"),
        ) as Record<string, unknown>;
        const toFixture = (s: string): string =>
          s.split("/ROOT/scripts/lib/").join(`${REPO}/scripts/lib/`).split("/ROOT").join(fixture);
        const render = (name: string, config: Record<string, unknown>): string => {
          const file = path.join(aux, `${name}.json`);
          const { repositoryUrl: _dropped, ...rest } = withoutPublishLeg(config);
          fs.writeFileSync(file, JSON.stringify(mapStrings(rest, toFixture)));
          const out = run(
            process.execPath,
            [path.join(REPO, "scripts", "lib", "release-rehearse.mjs"), "main", file],
            ext,
            {
              ...env,
              GITHUB_ACTIONS: "true",
              GITHUB_ACTION: "run",
              GITHUB_EVENT_NAME: "workflow_dispatch",
              GITHUB_REF: "refs/heads/main",
              GITHUB_REPOSITORY: "acme/fixture",
              GITHUB_SERVER_URL: "https://github.com",
              NODE_OPTIONS: `--require ${path.join(FIXTURES, "fixed-date.cjs")}`,
            },
          );
          const result = JSON.parse(out) as { released: boolean; notes: string | null };
          assert.equal(result.released, true, `${name}: the engine computed no release`);
          return String(result.notes);
        };
        const notesGolden = render("golden", golden);
        const notesEmitted = render("emitted", emitted);
        // Two empty strings are byte-identical too: the guard keeps the comparison meaningful.
        for (const notes of [notesGolden, notesEmitted]) {
          assert.ok(notes.length > 0 && notes.includes("foo"), `vacuous note: '${notes}'`);
        }
        assert.equal(notesEmitted, notesGolden);
      },
    );
  });
});

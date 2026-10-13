// monorepo-release-config.test.ts — the engine configuration and the prepare
// commands of the TypeScript release driver (spec 0257 R15, R16), with a
// differential against the shell oracle where bash and jq are available.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { emitReleaserc } from "../lib/monorepo-release/releaserc.ts";
import type { ReleasercInput } from "../lib/monorepo-release/releaserc-types.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const libDir = path.resolve(here, "..", "lib");
const V = "${nextRelease.version}";

const ENV = {
  GITHUB_SERVER_URL: "https://github.example",
  GITHUB_REPOSITORY: "acme/rig",
  CI_PROJECT_URL: "https://gitlab.example/acme/rig",
  CI_SERVER_URL: "https://gitlab.example",
};

type Forge = ReleasercInput["forge"];
type Mode = ReleasercInput["mode"];
const FORGES: Forge[] = ["github", "gitlab"];
const MODES: Mode[] = ["publish", "rehearsal", "prepare"];

function input(forge: Forge, mode: Mode, extra: Partial<ReleasercInput> = {}): ReleasercInput {
  return {
    forge,
    mode,
    ext: "foo",
    root: "/ROOT",
    out: "/ROOT/dist/release/foo",
    branch: "main",
    libDir,
    env: ENV,
    ...extra,
  };
}

function config(forge: Forge, mode: Mode): Record<string, unknown> {
  return JSON.parse(emitReleaserc(input(forge, mode))) as Record<string, unknown>;
}

function plugins(forge: Forge, mode: Mode): unknown[] {
  return config(forge, mode)["plugins"] as unknown[];
}

function names(forge: Forge, mode: Mode): string[] {
  return plugins(forge, mode).map((p) => (Array.isArray(p) ? String(p[0]) : String(p)));
}

describe("engine configuration", () => {
  for (const forge of FORGES) {
    for (const mode of MODES) {
      test(`${forge} ${mode}: key order and shape`, () => {
        const text = emitReleaserc(input(forge, mode));
        assert.ok(text.endsWith("}\n"));
        const keys = Object.keys(JSON.parse(text) as object);
        const wantUrl = forge === "gitlab" || mode !== "publish";
        assert.deepEqual(keys, [
          "extends",
          "branches",
          "tagFormat",
          "plugins",
          ...(wantUrl ? ["repositoryUrl"] : []),
        ]);
        const cfg = config(forge, mode);
        assert.equal(cfg["extends"], "semantic-release-monorepo");
        assert.deepEqual(cfg["branches"], ["main"]);
        assert.equal(cfg["tagFormat"], "foo-v${version}");
      });
    }
  }

  test("repositoryUrl per forge and mode", () => {
    assert.equal(
      config("gitlab", "publish")["repositoryUrl"],
      "https://gitlab.example/acme/rig.git",
    );
    assert.equal(
      config("gitlab", "rehearsal")["repositoryUrl"],
      "https://gitlab.example/acme/rig.git",
    );
    assert.equal(
      config("github", "rehearsal")["repositoryUrl"],
      "https://github.example/acme/rig.git",
    );
    assert.equal(
      config("github", "prepare")["repositoryUrl"],
      "https://github.example/acme/rig.git",
    );
    assert.equal(config("github", "publish")["repositoryUrl"], undefined);
  });

  test("github publish is tag-only: no changelog, no git leg", () => {
    assert.deepEqual(
      names("github", "publish").map((n) => (n.startsWith("@") ? n : path.basename(n))),
      ["gitmoji-esm-shim.mjs", "@semantic-release/exec", "@semantic-release/github"],
    );
  });

  test("exec precedes git on every other leg", () => {
    for (const [forge, mode] of [
      ["github", "prepare"],
      ["gitlab", "publish"],
      ["gitlab", "rehearsal"],
      ["gitlab", "prepare"],
      ["github", "rehearsal"],
    ] as const) {
      const n = names(forge, mode);
      assert.ok(
        n.indexOf("@semantic-release/exec") < n.indexOf("@semantic-release/git"),
        `${forge} ${mode}`,
      );
      assert.equal(path.basename(n[1] ?? ""), "changelog-plugin.ts");
    }
  });

  test("no rehearsal or prepare configuration has a publish entry", () => {
    for (const forge of FORGES) {
      for (const mode of ["rehearsal", "prepare"] as const) {
        assert.ok(!names(forge, mode).some((n) => /github$|gitlab$/.test(n)), `${forge} ${mode}`);
      }
    }
  });

  test("GitLab publish uploads exactly one asset, without a label", () => {
    const entry = plugins("gitlab", "publish").find(
      (p) => Array.isArray(p) && p[0] === "@semantic-release/gitlab",
    ) as [string, { assets: object[] }];
    assert.deepEqual(entry[1], {
      assets: [
        { path: "/ROOT/dist/release/foo/*.tar.gz", target: "generic_package", packageName: "foo" },
      ],
    });
  });

  test("GitHub publish keeps the historical label", () => {
    const entry = plugins("github", "publish").find(
      (p) => Array.isArray(p) && p[0] === "@semantic-release/github",
    ) as [string, { assets: object[] }];
    assert.deepEqual(entry[1], {
      assets: [{ path: "/ROOT/dist/release/foo/*.tar.gz", label: "foo (installable tree)" }],
    });
  });

  test("commit messages: [skip ci] everywhere except prepare", () => {
    const msg = (forge: Forge, mode: Mode): unknown => {
      const e = plugins(forge, mode).find(
        (p) => Array.isArray(p) && p[0] === "@semantic-release/git",
      ) as [string, { message: string }];
      return e[1].message;
    };
    assert.equal(
      msg("gitlab", "publish"),
      "🔖 foo-v${nextRelease.version} [skip ci]\n\n${nextRelease.notes}",
    );
    assert.equal(
      msg("github", "rehearsal"),
      "🔖 foo-v${nextRelease.version} [skip ci]\n\n${nextRelease.notes}",
    );
    assert.equal(
      msg("github", "prepare"),
      "🔖 foo-v${nextRelease.version}\n\n${nextRelease.notes}",
    );
  });

  test("the exec command follows the mode", () => {
    const cmd = (forge: Forge, mode: Mode): string => {
      const e = plugins(forge, mode).find(
        (p) => Array.isArray(p) && p[0] === "@semantic-release/exec",
      ) as [string, { prepareCmd: string }];
      return e[1].prepareCmd;
    };
    assert.equal(cmd("github", "prepare"), `node "/ROOT/scripts/release-sync-manifests.ts" ${V}`);
    assert.ok(cmd("gitlab", "publish").includes("release-package-extension.ts"));
    for (const forge of FORGES)
      for (const mode of MODES) assert.ok(!/bash|jq/.test(cmd(forge, mode)));
  });

  test("the GitLab notes leg carries the project and server URLs", () => {
    const e = plugins("gitlab", "rehearsal")[0] as [
      string,
      {
        releaseNotes: {
          template: string;
          partials: { commitTemplate: string };
          issueResolution: { template: string };
        };
      },
    ];
    const notes = e[1].releaseNotes;
    assert.ok(
      !notes.template.includes("@@PROJECT_URL@@") && notes.template.includes(ENV.CI_PROJECT_URL),
    );
    assert.ok(notes.partials.commitTemplate.includes(ENV.CI_PROJECT_URL));
    assert.equal(
      notes.issueResolution.template,
      "https://gitlab.example/{owner}/{repo}/-/issues/{ref}",
    );
    const gh = plugins("github", "rehearsal")[0] as [string, object];
    assert.deepEqual(Object.keys(gh[1]), ["releaseRules"]);
  });

  test("win32 writes forward slashes into the configuration", () => {
    const text = emitReleaserc(
      input("github", "prepare", {
        platform: "win32",
        root: "C:\\r",
        out: "C:\\r\\o",
        libDir: "C:\\r\\scripts\\lib",
      }),
    );
    assert.ok(text.includes("C:/r/scripts/lib/release-notes/gitmoji-esm-shim.mjs"));
    assert.ok(!text.includes("\\\\r"));
  });
});

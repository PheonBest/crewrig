// monorepo-release-config-oracle.test.ts — differential of the TypeScript engine
// configuration against the shell oracle `emit_releaserc` (spec 0257 R15), run
// only where bash and jq are available. Deviation (b): the two prepareCmd
// strings differ by design and are blanked on both sides.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { emitReleaserc } from "../lib/monorepo-release/releaserc.ts";
import type { ReleasercInput } from "../lib/monorepo-release/releaserc-types.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const libDir = path.resolve(here, "..", "lib");

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

function input(forge: Forge, mode: Mode): ReleasercInput {
  return {
    forge,
    mode,
    ext: "foo",
    root: "/ROOT",
    out: "/ROOT/dist/release/foo",
    branch: "main",
    libDir,
    env: ENV,
  };
}

function have(cmd: string): boolean {
  return spawnSync(cmd, ["--version"], { stdio: "ignore" }).status === 0;
}

describe("differential against the shell oracle", { skip: !(have("bash") && have("jq")) }, () => {
  const shellLib = path.join(libDir, "monorepo-release-lib.sh");
  const env: NodeJS.ProcessEnv = { ...process.env, ...ENV };
  delete env["NODE_TEST_CONTEXT"];
  delete env["CI"];

  function jq(text: string): string {
    const r = spawnSync("jq", ["-S", "."], { input: text, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  }

  // Deviation (b) of the spec: the two command strings differ by design.
  function blank(text: string): unknown {
    const cfg = JSON.parse(jq(text)) as { plugins: unknown[] };
    for (const p of cfg.plugins) {
      if (Array.isArray(p) && p[0] === "@semantic-release/exec")
        (p[1] as { prepareCmd: string }).prepareCmd = "";
    }
    return cfg;
  }

  for (const forge of FORGES) {
    for (const mode of MODES) {
      test(`${forge} ${mode} equals the shell output but for prepareCmd`, () => {
        const sh = spawnSync(
          "bash",
          [
            "-c",
            'source "$1" && emit_releaserc "$2" "$3" foo /ROOT /ROOT/dist/release/foo main',
            "bash",
            shellLib,
            forge,
            mode,
          ],
          { env, encoding: "utf8" },
        );
        assert.equal(sh.status, 0, sh.stderr);
        assert.deepEqual(blank(emitReleaserc(input(forge, mode))), blank(sh.stdout));
      });
    }
  }
});

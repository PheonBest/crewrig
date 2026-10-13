// Spec 0257 R14: the rehearsal flow, driven with a fake mirror and a fake engine.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import type { LinkOutcome } from "../lib/link-or-copy.ts";
import type { RehearseOptions } from "../lib/monorepo-release/engine.ts";
import { realDeps } from "../lib/monorepo-release/flow-deps.ts";
import type { FlowDeps } from "../lib/monorepo-release/flow-deps.ts";
import { releaseRehearse } from "../lib/monorepo-release/flow-rehearsal.ts";
import { makeFlowHarness } from "./lib/release-flow-ctx.ts";
import type { FlowHarness } from "./lib/release-flow-ctx.ts";

interface Verdict {
  status?: number;
  json?: unknown;
  /** The command the packaging step runs, instead of the real packager's. */
  prepare?: string;
}

const RELEASED = {
  released: true,
  version: "1.2.0",
  gitTag: "alpha-v1.2.0",
  lastTag: "alpha-v1.1.0",
  notes: "## 1.2.0\n- a thing",
};

/** A node program, written to a file so the command string holds no quoting of its own. */
function script(dir: string, name: string, body: string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, body);
  return `node "${file}"`;
}

interface Run {
  readonly h: FlowHarness;
  readonly engine: RehearseOptions[];
  readonly mirror: Array<{ forgeUrl: string; dir: string }>;
  readonly deps: FlowDeps;
}

let harness: FlowHarness | undefined;
afterEach(() => harness?.dispose());

function setup(
  verdicts: Record<string, Verdict>,
  extra: {
    outcomes?: LinkOutcome[];
    env?: Record<string, string | undefined>;
    aborted?: () => boolean;
  } = {},
): Run {
  const h = makeFlowHarness({
    forge: "github",
    env: extra.env ?? {},
    ...(extra.aborted === undefined ? {} : { aborted: extra.aborted }),
  });
  harness = h;
  const engine: RehearseOptions[] = [];
  const mirror: Array<{ forgeUrl: string; dir: string }> = [];
  const deps: FlowDeps = {
    ...realDeps,
    makeMirror: (opts) => {
      mirror.push({ forgeUrl: opts.forgeUrl, dir: opts.dir });
      for (const ext of Object.keys(verdicts))
        h.addExtension("core", ext, path.join(opts.dir, "clone"));
    },
    stageCloneModules: () => extra.outcomes ?? [],
    sha256File: (file) => `sha(${path.basename(file)})`,
    runRehearse: (opts) => {
      engine.push(opts);
      const verdict = verdicts[path.basename(opts.dir)] ?? {};
      opts.stderr("engine log\n");
      return Promise.resolve({
        status: verdict.status ?? 0,
        json: JSON.stringify(verdict.json ?? { released: false }),
      });
    },
    prepareCommand: (opts) => {
      const verdict = verdicts[opts.ext] ?? {};
      return verdict.prepare ?? `node -e "process.exit(0)"`;
    },
  };
  return { h, engine, mirror, deps };
}

describe("releaseRehearse", () => {
  it("builds the mirror for the forge URL and strips credentials from the engine environment", async () => {
    const { h, engine, mirror, deps } = setup(
      { alpha: {} },
      { env: { GITHUB_TOKEN: "t", MY_SECRET: "s", KEEP: "k" } },
    );
    await releaseRehearse(h.ctx, deps);
    assert.deepEqual(mirror, [
      {
        forgeUrl: "https://github.example/o/r.git",
        dir: path.join(h.ctx.scratch.dir, "rehearsal"),
      },
    ]);
    const [run] = engine;
    assert.ok(run);
    assert.equal(run.apply, false);
    assert.equal(run.env["GITHUB_TOKEN"], undefined);
    assert.equal(run.env["MY_SECRET"], undefined);
    assert.equal(run.env["KEEP"], "k");
    assert.equal(run.libDir, path.join(h.ctx.scriptsDir, "lib"));
    assert.equal(h.rawErr.join(""), "engine log\n");
  });

  it("prints UNCHANGED when nothing is released, and removes the releaserc", async () => {
    const { h, engine, deps } = setup({ alpha: { json: { released: false } } });
    await releaseRehearse(h.ctx, deps);
    assert.deepEqual(h.stdout, ["", "--- Rehearsing: alpha ---", "UNCHANGED alpha"]);
    assert.equal(h.ctx.errors, 0);
    assert.equal(fs.existsSync(engine[0]?.releasercPath ?? "x"), false);
  });

  it("prints the REHEARSAL line and the notes once the archive exists", async () => {
    const out = (h: FlowHarness): string => path.join(h.ctx.scratch.dir, "rehearsal/out/alpha");
    const { h, deps } = setup({ alpha: { json: RELEASED } });
    harness = h;
    const write = script(
      h.ctx.scratch.dir,
      "pack.cjs",
      `require("node:fs").writeFileSync(${JSON.stringify(path.join(out(h), "a.tar.gz"))}, "x");\n`,
    );
    await releaseRehearse(h.ctx, {
      ...deps,
      prepareCommand: () => write,
    });
    assert.deepEqual(h.stdout, [
      "",
      "--- Rehearsing: alpha ---",
      "REHEARSAL alpha version=1.2.0 tag=alpha-v1.2.0 baseline=alpha-v1.1.0 archive=a.tar.gz sha256=sha(a.tar.gz)",
      "## 1.2.0\n- a thing",
    ]);
    assert.equal(h.ctx.errors, 0);
  });

  it("defaults the baseline to none", async () => {
    const { h, deps } = setup({ alpha: { json: { ...RELEASED, lastTag: null } } });
    const write = script(
      h.ctx.scratch.dir,
      "pack.cjs",
      `require("node:fs").writeFileSync(${JSON.stringify(path.join(h.ctx.scratch.dir, "rehearsal/out/alpha/a.tar.gz"))}, "x");\n`,
    );
    await releaseRehearse(h.ctx, { ...deps, prepareCommand: () => write });
    assert.match(h.stdout[2] ?? "", / baseline=none /);
  });

  it("reports a non-SemVer version as an engine failure and continues", async () => {
    const { h, deps } = setup({
      alpha: { json: { ...RELEASED, version: "1.2" } },
      beta: { json: { released: false } },
    });
    await releaseRehearse(h.ctx, deps);
    assert.deepEqual(h.stdout, [
      "",
      "--- Rehearsing: alpha ---",
      "RELEASE-FAILED alpha step=engine",
      "",
      "--- Rehearsing: beta ---",
      "UNCHANGED beta",
    ]);
    assert.deepEqual(h.stderr, ["Error: the engine computed a version that is not SemVer"]);
    assert.equal(h.ctx.errors, 1);
  });

  it("reports an engine failure and keeps going", async () => {
    const { h, deps } = setup({ alpha: { status: 1 }, beta: { json: { released: false } } });
    await releaseRehearse(h.ctx, deps);
    assert.deepEqual(h.stdout, [
      "",
      "--- Rehearsing: alpha ---",
      "RELEASE-FAILED alpha step=engine",
      "",
      "--- Rehearsing: beta ---",
      "UNCHANGED beta",
    ]);
    assert.equal(h.ctx.errors, 1);
  });

  it("reports a failing packaging command as step=package", async () => {
    const { h, deps } = setup({
      alpha: { json: RELEASED, prepare: `node -e "process.exit(1)"` },
    });
    await releaseRehearse(h.ctx, deps);
    assert.deepEqual(h.stdout, [
      "",
      "--- Rehearsing: alpha ---",
      "RELEASE-FAILED alpha step=package",
    ]);
    assert.equal(h.ctx.errors, 1);
  });

  it("reports a packaging command that leaves no archive as step=package", async () => {
    const { h, deps } = setup({ alpha: { json: RELEASED } });
    await releaseRehearse(h.ctx, deps);
    assert.deepEqual(h.stdout, [
      "",
      "--- Rehearsing: alpha ---",
      "RELEASE-FAILED alpha step=package",
    ]);
    assert.equal(h.ctx.errors, 1);
  });

  it("prints the link fallback notice once on stderr, only when there is one", async () => {
    const outcome: LinkOutcome = {
      method: "fallback-copy",
      dest: "/clone/node_modules/x",
      source: "/root/node_modules/x",
      code: "EPERM",
    };
    const withNotice = setup({ alpha: {}, beta: {} }, { outcomes: [outcome] });
    await releaseRehearse(withNotice.h.ctx, withNotice.deps);
    assert.equal(withNotice.h.stderr.length, 1);
    assert.match(withNotice.h.stderr[0] ?? "", /^Symbolic links were refused \(EPERM\)/);
    withNotice.h.dispose();

    const without = setup({ alpha: {} });
    await releaseRehearse(without.h.ctx, without.deps);
    assert.deepEqual(without.h.stderr, []);
  });
  it("reports nothing for an engine child killed by the driver's own signal", async () => {
    let signalled = false;
    const { h, deps } = setup({ alpha: {}, beta: {} }, { aborted: () => signalled });
    await releaseRehearse(h.ctx, {
      ...deps,
      runRehearse: () => {
        signalled = true;
        return Promise.resolve({ status: 143, json: "" });
      },
    });
    assert.equal(
      h.stdout.some((line) => line.startsWith("RELEASE-FAILED")),
      false,
    );
    assert.equal(h.stdout.includes("--- Rehearsing: beta ---"), false);
    assert.equal(h.ctx.errors, 0);
  });

  it("reports nothing for a packaging child killed by the driver's own signal", async () => {
    let signalled = false;
    const { h, deps } = setup({ alpha: { json: RELEASED } }, { aborted: () => signalled });
    await releaseRehearse(h.ctx, {
      ...deps,
      prepareCommand: () => {
        signalled = true;
        return `node -e "process.exit(143)"`;
      },
    });
    assert.equal(
      h.stdout.some((line) => line.startsWith("RELEASE-FAILED") || line.startsWith("REHEARSAL")),
      false,
    );
    assert.equal(h.ctx.errors, 0);
  });
});

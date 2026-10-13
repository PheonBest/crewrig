// packaging-entries-differential.test.ts — `package-extension` and `package-extensions` run next
// to the shell tools they replace on equal sandboxes (spec 0257 R12): exit status, stdout, stderr
// (paths normalised) and the extracted `dist/release` trees must agree. The behaviour itself is
// in packaging-entries.test.ts.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  addExtension,
  baseEnv,
  makeSandbox,
  NAME,
  runEntry,
  stubBuilder,
  toolPath,
  treeOfDir,
  twoPerTier,
} from "./lib/release-sandbox.ts";
import type { Sandbox } from "./lib/release-sandbox.ts";

const probe = (cmd: string): boolean => spawnSync(cmd, ["--version"]).error === undefined;
const skipShell =
  process.platform === "win32" || !["bash", "jq", "tar"].every(probe)
    ? "skipped: the shell oracle needs bash, jq and tar on a POSIX host"
    : false;

const SHELL_TOOLS = [
  "bash",
  "node",
  "jq",
  "tar",
  "dirname",
  "basename",
  "find",
  "wc",
  "tr",
  "mkdir",
  "paste",
  "cat",
  "rm",
];

/** Everything under `dist/release`, an archive replaced by what extracting it produces. */
function releaseTrees(sandbox: Sandbox): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const root = sandbox.resolve("dist/release");
  if (!fs.existsSync(root)) return out;
  for (const [rel, content] of Object.entries(treeOfDir(root))) {
    if (!rel.endsWith(".tar.gz")) {
      out[rel] = content;
      continue;
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "entries-extract-"));
    try {
      const res = spawnSync("tar", ["-xzf", path.join(root, rel), "-C", dir]);
      assert.equal(res.status, 0, String(res.stderr));
      out[rel] = treeOfDir(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  return out;
}

interface Scenario {
  readonly title: string;
  readonly tool: "one" | "all";
  readonly setup?: (sandbox: Sandbox) => void;
  readonly args?: string[];
  readonly env?: NodeJS.ProcessEnv;
}

const MANIFEST = `extensions/core/${NAME}/extension.json`;
const SCENARIOS: Scenario[] = [
  { title: "one: success", tool: "one", env: { EXT: NAME } },
  { title: "one: EXT unset", tool: "one" },
  { title: "one: EXT empty", tool: "one", env: { EXT: "" } },
  { title: "one: unknown", tool: "one", env: { EXT: "nope" } },
  {
    title: "one: two tiers",
    tool: "one",
    env: { EXT: NAME },
    setup: (s) => addExtension(s, "org", NAME),
  },
  {
    title: "one: no version",
    tool: "one",
    env: { EXT: NAME },
    setup: (s) => s.write(MANIFEST, '{"name":"hello-world","version":null}'),
  },
  {
    title: "one: missing manifest",
    tool: "one",
    env: { EXT: NAME },
    setup: (s) => s.remove(MANIFEST),
  },
  {
    title: "one: array manifest",
    tool: "one",
    env: { EXT: NAME },
    setup: (s) => s.write(MANIFEST, "[1]"),
  },
  {
    title: "one: stale output",
    tool: "one",
    env: { EXT: NAME },
    setup: (s) => s.write(`dist/release/${NAME}/stale.txt`, "x"),
  },
  { title: "all: core and library", tool: "all", setup: twoPerTier },
  { title: "all: --include-org", tool: "all", args: ["--include-org"], setup: twoPerTier },
  { title: "all: INCLUDE_ORG=1", tool: "all", env: { INCLUDE_ORG: "1" }, setup: twoPerTier },
  { title: "all: INCLUDE_ORG empty", tool: "all", env: { INCLUDE_ORG: "" }, setup: twoPerTier },
  {
    title: "all: stops at the first failure",
    tool: "all",
    setup: (s) => {
      addExtension(s, "core", "hello-xtra");
      addExtension(s, "library", "lib-one");
      stubBuilder(s, ["hello-xtra"]);
    },
  },
];

for (const scenario of SCENARIOS) {
  test(`differential against the shell: ${scenario.title}`, { skip: skipShell }, () => {
    const shell = makeSandbox();
    const port = makeSandbox();
    for (const sandbox of [shell, port]) scenario.setup?.(sandbox);
    const env: NodeJS.ProcessEnv = {
      ...baseEnv(toolPath(SHELL_TOOLS)),
      LC_ALL: "C",
      ...scenario.env,
    };
    const args = scenario.args ?? [];
    const script = scenario.tool === "one" ? "package-extension.sh" : "package-extensions.sh";

    const oracle = spawnSync("bash", [`scripts/${script}`, ...args], {
      cwd: shell.root,
      env,
      encoding: "utf8",
    });
    const ported = runEntry(
      port,
      scenario.tool === "one" ? "package-one" : "package-all",
      args,
      env,
    );

    const normalise = (text: string, root: string): string => text.split(root).join("<ROOT>");
    assert.equal(ported.status, oracle.status);
    assert.equal(normalise(ported.stdout, port.root), normalise(oracle.stdout, shell.root));
    assert.equal(normalise(ported.stderr, port.root), normalise(oracle.stderr, shell.root));
    assert.deepEqual(releaseTrees(port), releaseTrees(shell));
  });
}

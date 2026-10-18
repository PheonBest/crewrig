// sync-from-upstream-preserve.test.ts — `--preserve-history` of scripts/sync-from-upstream.ts
// (spec 0260; replaces group G6 (t, u, v, w, x, y) and case tt of test-sync-from-upstream.sh).

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import {
  cloneFull,
  cloneShallow,
  commitFiles,
  createSyncRoot,
  git,
  headOf,
  makeAdopter,
  makeUpstream,
  read,
  runSync,
  tomlPath,
  why,
  writeFile,
  type SyncRoot,
} from "./lib/sync-fixture.ts";

let sr: SyncRoot;
before(() => {
  sr = createSyncRoot("crewrig-sync-pres-");
});
after(() => sr.dispose());

const PRESERVE = { args: ["--preserve-history"] };

/** Config and manifest committed on top of an existing clone (`add -A`, as the Bash cases did). */
function commitConfig(adopter: string, upstream: string, manifest: string): void {
  commitFiles(sr, adopter, "adopter config", {
    "crewrig.config.toml": `canonical_repo = "${tomlPath(upstream)}"\n`,
    ".crewrig/core-paths.txt": manifest,
  });
}

describe("G6 --preserve-history (spec 0086)", () => {
  // t
  test("t graft ancestry: upstream sha is an ancestor and the files equal a plain sync", () => {
    const upstream = makeUpstream(sr, [
      { "core-file.txt": "upstream v1 content", "other.txt": "other content" },
      { "core-file.txt": "upstream v2 content" },
    ]);
    const upstreamSha = headOf(sr, upstream);
    const spec = {
      upstream,
      manifest: ["core-file.txt"],
      files: { "core-file.txt": "upstream v1 content", "other.txt": "other content" },
    };
    const hist = makeAdopter(sr, spec);
    const plain = makeAdopter(sr, spec);

    const histOut = runSync(sr, hist, PRESERVE);
    const plainOut = runSync(sr, plain);
    assert.equal(histOut.status, 0, why(histOut));
    assert.equal(plainOut.status, 0, why(plainOut));
    // exit 0 of git means "is an ancestor"; any other status fails the assertion.
    git(sr, hist, "merge-base", "--is-ancestor", upstreamSha, "HEAD");
    assert.equal(read(hist, "core-file.txt"), "upstream v2 content");
    assert.equal(read(hist, "core-file.txt"), read(plain, "core-file.txt"));
    assert.equal(read(hist, "other.txt"), read(plain, "other.txt"));
  });

  // u
  test("u no-op when FETCH_HEAD is already an ancestor: HEAD unchanged, `no-op`, exit 0", () => {
    const upstream = makeUpstream(sr, [{ "core-file.txt": "upstream content" }]);
    const adopter = cloneFull(sr, upstream, "adopter-full");
    commitConfig(adopter, upstream, "core-file.txt\n");
    const tip = headOf(sr, adopter);
    const out = runSync(sr, adopter, PRESERVE);
    assert.equal(out.status, 0, why(out));
    assert.equal(headOf(sr, adopter), tip, "a commit was created");
    assert.ok(out.stdout.includes("no-op"), why(out));
  });

  // v
  test("v shallow clone refuses before any fetch, restore or commit", () => {
    const upstream = makeUpstream(sr, [{ "core-file.txt": "upstream content" }]);
    const seed = makeUpstream(sr, [
      { "core-file.txt": "seed content v1" },
      { "core-file.txt": "seed content v2" },
    ]);
    const adopter = cloneShallow(sr, seed);
    commitConfig(adopter, upstream, "core-file.txt\n");
    const tip = headOf(sr, adopter);
    const out = runSync(sr, adopter, PRESERVE);
    assert.notEqual(out.status, 0, why(out));
    assert.match(out.output, /shallow/i, why(out));
    assert.ok(!out.output.includes("Fetching"), `a fetch was attempted\n${why(out)}`);
    assert.equal(headOf(sr, adopter), tip, "a commit was created");
    assert.equal(read(adopter, "core-file.txt"), "seed content v2");
  });

  // w, x, y: R8 guard, restore applied before the guard fires
  interface GuardCase {
    label: string;
    upstream: Array<Record<string, string>>;
    manifest: string[];
    files: Record<string, string>;
    edited: string;
    editedContent: string;
    restored: [string, string];
  }
  const guardCases: GuardCase[] = [
    {
      label: "w unrelated path outside the manifest",
      upstream: [
        { "core-file.txt": "upstream v1 content" },
        { "core-file.txt": "upstream v2 content" },
      ],
      manifest: ["core-file.txt"],
      files: {
        "core-file.txt": "upstream v1 content",
        "unrelated.txt": "original unrelated content",
      },
      edited: "unrelated.txt",
      editedContent: "locally edited unrelated content",
      restored: ["core-file.txt", "upstream v2 content"],
    },
    {
      label: "x excluded child nested under a strict parent (specs/org)",
      upstream: [{ "specs/0001.md": "spec v1 content" }, { "specs/0001.md": "spec v2 content" }],
      manifest: ["specs", "specs/org\texcluded"],
      files: { "specs/0001.md": "spec v1 content", "specs/org/custom.md": "org content v1" },
      edited: "specs/org/custom.md",
      editedContent: "locally edited org content",
      restored: ["specs/0001.md", "spec v2 content"],
    },
    {
      label: "y top-level excluded entry (AGENTS.org.md)",
      upstream: [
        { "core-file.txt": "upstream v1 content" },
        { "core-file.txt": "upstream v2 content" },
      ],
      manifest: ["core-file.txt", "AGENTS.org.md\texcluded"],
      files: { "core-file.txt": "upstream v1 content", "AGENTS.org.md": "org rules v1" },
      edited: "AGENTS.org.md",
      editedContent: "locally edited org rules",
      restored: ["core-file.txt", "upstream v2 content"],
    },
  ];
  for (const c of guardCases) {
    test(`${c.label}: R8 guard blocks the graft after the restore applied`, () => {
      const upstream = makeUpstream(sr, c.upstream);
      const adopter = makeAdopter(sr, { upstream, manifest: c.manifest, files: c.files });
      const tip = headOf(sr, adopter);
      writeFile(adopter, c.edited, c.editedContent);
      const out = runSync(sr, adopter, PRESERVE);
      assert.notEqual(out.status, 0, why(out));
      assert.ok(out.output.includes(c.edited), `offending path not printed\n${why(out)}`);
      assert.equal(
        read(adopter, c.restored[0] as string),
        c.restored[1],
        "restore must precede the guard",
      );
      assert.equal(read(adopter, c.edited), c.editedContent, "the edit was lost");
      assert.equal(headOf(sr, adopter), tip, "a graft commit was created");
    });
  }
});

describe("tt regenerable under --preserve-history (spec 0199 R49)", () => {
  const manifest = [".claude/agents\tregenerable"];
  // `add -A` fixtures (makeAdopter) keep the adopter tree distinct from upstream's: no R11 no-op.
  const adopterFor = (upstream: string): string =>
    makeAdopter(sr, { upstream, manifest, files: { ".claude/agents/dev.md": "upstream agent\n" } });

  // tt-1
  test("tt-1 an uncommitted change under a regenerable entry does not block the graft", () => {
    const upstream = makeUpstream(sr, [{ ".claude/agents/dev.md": "upstream agent" }]);
    const adopter = adopterFor(upstream);
    writeFile(adopter, ".claude/agents/dev.md", "regenerated locally, uncommitted\n");
    const out = runSync(sr, adopter, PRESERVE);
    assert.equal(out.status, 0, why(out));
  });

  // tt-2
  test("tt-2 an uncommitted ungoverned change (notes.md) still blocks: exit 1 names it", () => {
    const upstream = makeUpstream(sr, [{ ".claude/agents/dev.md": "upstream agent" }]);
    const adopter = adopterFor(upstream);
    writeFile(adopter, "notes.md", "ungoverned local edit\n");
    const out = runSync(sr, adopter, PRESERVE);
    assert.equal(out.status, 1, why(out));
    assert.ok(out.stderr.includes("notes.md"), why(out));
  });
});

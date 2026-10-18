// packaging-release-differential.ts — the cases of the entry-level differential proof (spec 0257
// R24, R25, plan PR 5 step 20). Each case is run through the entries as black boxes, in a fresh
// sandbox per leg; `packaging-release-differential.test.ts` compares the legs and the goldens.

import { writeTree } from "./extension-trees.ts";
import type { FileMap } from "./extension-trees.ts";
import { page, published } from "./docs-index-trees.ts";
import type { DiffCase } from "./packaging-release-observe.ts";
import { addExtension, NAME, stubBuilder, twoPerTier } from "./release-sandbox.ts";
import type { Sandbox } from "./release-sandbox.ts";

const MANIFEST = `extensions/core/${NAME}/extension.json`;

const CLEAN: FileMap = {
  "docs/intro.md": published("introduction", "1", "Intro page"),
  "docs/a.md": published("concepts", "5", "Dot sorts first"),
  "docs/a/b.md": published("concepts", "5", "Slash sorts after"),
  "docs/Z.md": published("concepts", "5", "Upper case first"),
  "docs/ten.md": published("adoption", "10", "Ten"),
  "docs/nine.md": published("adoption", "9", "Nine"),
  "docs/adr/0001.md": published("architecture-adr", "0", "An ADR"),
  "docs/draft.md": page("published=false"),
  "docs/\u{1F600}.md": published("reference", "1", "Astral"),
  "docs/slash\\back.md": published("lifecycle", "3", "Back\\slash"),
  "docs/notes.txt": "not a page\n",
};

const BROKEN: FileMap = {
  "docs/none.md": "# Title\n\nNo block here.\n",
  "docs/noeq.md": page("published"),
  "docs/unterminated.md": page('published=true title="oops'),
  "docs/forbidden.md": page("published=true title=a>b"),
  "docs/unknown.md": page("published=true colour=red"),
  "docs/badpub.md": page("published=yes"),
  "docs/missing.md": page("published=true"),
  "docs/badsection.md": page("published=true title=t section=nope nav_order=1"),
  "docs/badnav.md": page("published=true title=t section=concepts nav_order=-1"),
  "docs/fine.md": published("concepts", "1", "Fine"),
};

const REAL: FileMap = { "docs/real.md": published("concepts", "1", "Real") };

const files =
  (map: FileMap) =>
  (box: Sandbox | { root: string }): void =>
    writeTree(box.root, map);
const crlf = (map: FileMap): FileMap =>
  Object.fromEntries(Object.entries(map).map(([f, t]) => [f, t.replaceAll("\n", "\r\n")]));

function docs(name: string, map: FileMap, args: string[], before: string[][] = []): DiffCase {
  return {
    name: `docs-${name}`,
    kind: "docs",
    script: "build-docs-index",
    args: () => args,
    setup: files(map),
    before,
  };
}

const DOCS: DiffCase[] = [
  docs("clean-write", CLEAN, []),
  docs("clean-check", CLEAN, ["--check"], [[]]),
  docs("crlf-write", crlf(CLEAN), []),
  docs("lint-write", BROKEN, []),
  docs("lint-check", BROKEN, ["--check"]),
  docs(
    "orphan",
    {
      ...REAL,
      "docs/index.json": '{"pages": [{"path":  "docs/gone.md"}, {"path": "docs/real.md"}]}\n',
    },
    [],
  ),
  docs("drift-check", { ...REAL, "docs/index.json": "{}\n" }, ["--check"]),
  docs("missing-manifest-check", REAL, ["--check"]),
  docs("empty-docs", { "docs/.keep": "" }, []),
  docs("no-docs-dir", { "other.txt": "x" }, []),
  docs("usage-unknown-flag", CLEAN, ["--bogus"]),
  docs("usage-extra-argument", CLEAN, ["--check", "extra"]),
  {
    ...docs("invalid-utf8-page", REAL, []),
    setup: (box) => {
      writeTree(box.root, REAL);
      box.write(
        "docs/bad.md",
        Buffer.from(
          `# T\n\n<!-- crewrig-doc: section=concepts nav_order=2 published=true title="bad \xff byte" -->\n`,
          "latin1",
        ),
      );
    },
  },
];

const release = (
  name: string,
  extra: Partial<DiffCase> & { args?: DiffCase["args"] } = {},
): DiffCase => ({
  name: `release-${name}`,
  kind: "packaging",
  script: "release-package-extension",
  args: (v) => [NAME, "--version", v, "--out", "dist/release/out"],
  ...extra,
});

const RELEASE: DiffCase[] = [
  release("hello-world"),
  release("occupied-out-dir", {
    setup: (box) => void box.write("dist/release/out/stale.txt", "x"),
  }),
  release("version-mismatch", {
    args: () => [NAME, "--version", "0.0.0-mismatch", "--out", "dist/release/out"],
  }),
  release("releaserc-in-source", {
    setup: (box) =>
      void box.write(`extensions/core/${NAME}/.releaserc.json`, '{"branches":["main"]}\n'),
  }),
  release("usage-error", { args: () => [] }),
  release("unknown-extension", {
    args: (v) => ["nope", "--version", v, "--out", "dist/release/out"],
  }),
  release("unexpected-argument", {
    args: (v) => [NAME, "extra", "--version", v, "--out", "dist/release/out"],
  }),
  release("two-tier-name", { setup: (box) => addExtension(box as Sandbox, "org", NAME) }),
];

const one = (name: string, env: Record<string, string>, setup?: DiffCase["setup"]): DiffCase => ({
  name: `package-${name}`,
  kind: "packaging",
  script: "package-extension",
  args: () => [],
  env,
  ...(setup === undefined ? {} : { setup }),
});

const ONE: DiffCase[] = [
  one("one-hello-world", { EXT: NAME }),
  one("one-ext-unset", {}),
  one("one-ext-empty", { EXT: "" }),
  one("one-ext-unknown", { EXT: "nope" }),
  one("one-two-tier-name", { EXT: NAME }, (box) => addExtension(box as Sandbox, "org", NAME)),
  one(
    "one-version-null",
    { EXT: NAME },
    (box) => void box.write(MANIFEST, '{"name":"hello-world","version":null}'),
  ),
  one("one-invalid-manifest", { EXT: NAME }, (box) => void box.write(MANIFEST, "{not json")),
  one(
    "one-occupied-out-dir",
    { EXT: NAME },
    (box) => void box.write(`dist/release/${NAME}/stale.txt`, "x"),
  ),
  one(
    "one-releaserc-in-source",
    { EXT: NAME },
    (box) => void box.write(`extensions/core/${NAME}/.releaserc.json`, "{}\n"),
  ),
];

const all = (
  name: string,
  env: Record<string, string>,
  args: string[],
  setup: DiffCase["setup"],
): DiffCase => ({
  name: `package-all-${name}`,
  kind: "packaging",
  script: "package-extensions",
  args: () => args,
  env,
  setup,
});

const ALL: DiffCase[] = [
  all("core-and-library", {}, [], (box) => twoPerTier(box as Sandbox)),
  all("include-org-flag", {}, ["--include-org"], (box) => twoPerTier(box as Sandbox)),
  all("include-org-env", { INCLUDE_ORG: "1" }, [], (box) => twoPerTier(box as Sandbox)),
  all("include-org-empty", { INCLUDE_ORG: "" }, [], (box) => twoPerTier(box as Sandbox)),
  all("stops-at-first-failure", {}, [], (box) => {
    addExtension(box as Sandbox, "core", "hello-xtra");
    addExtension(box as Sandbox, "library", "lib-one");
    stubBuilder(box as Sandbox, ["hello-xtra"]);
  }),
];

function sync(name: string, map: FileMap, args: string[]): DiffCase {
  // Run in `work/`: Node reads the nearest package.json of the entry, which must stay the sandbox's.
  return {
    name: `sync-${name}`,
    kind: "sync",
    script: "release-sync-manifests",
    oracle: false,
    cwd: "work",
    args: () => args,
    setup: (box) => writeTree(`${box.root}/work`, map),
  };
}

const PKG = '{\n  "name": "x",\n  "version": "0.0.1",\n  "private": true\n}\n';
const EXT = '{"name":"x","description":"d","version":"0.0.1"}\r\n';

const SYNC: DiffCase[] = [
  sync("both-manifests", { "package.json": PKG, "extension.json": EXT }, ["1.2.3"]),
  sync("package-only", { "package.json": PKG }, ["1.2.3"]),
  sync("no-version-key", { "extension.json": '{"name":"x"}\n' }, ["2.0.0"]),
  sync("no-manifest", { "other.txt": "x" }, ["1.2.3"]),
  sync("parse-both-before-writing", { "package.json": PKG, "extension.json": "{broken" }, [
    "1.2.3",
  ]),
  sync("not-an-object", { "package.json": "[1]\n" }, ["1.2.3"]),
  sync("usage-missing-version", { "package.json": PKG }, []),
  sync("usage-empty-version", { "package.json": PKG }, [""]),
  sync("usage-extra-argument", { "package.json": PKG }, ["1.2.3", "extra"]),
];

export const CASES: readonly DiffCase[] = [...DOCS, ...RELEASE, ...ONE, ...ALL, ...SYNC];

// chroma-wrapper-source.test.ts — read-only text checks of the ChromaDB HTTP
// wrapper (scripts/lib/mempalace-http-wrapper.py): the PersistentClient patch is
// applied before mempalace is imported, the chromadb version pin comment, the
// literal connection-pool defaults, and `settings=` at both HttpClient call
// sites. Retires G2-G6 of test-chroma-server.sh (spec 0263); G1 (no
// PersistentClient in the start entry) stays pinned by chroma-launch.test.ts.
// Pure file reads, no scratch HOME needed; runs on every platform.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { REPO } from "./lib/chroma-stand-in.ts";

const wrapper = fs.readFileSync(path.join(REPO, "scripts/lib/mempalace-http-wrapper.py"), "utf8");
const lines = wrapper.split(/\r?\n/);

/** 1-based number of the first line matching, or 0 when none does. */
const firstLine = (re: RegExp): number => lines.findIndex((l) => re.test(l)) + 1;

const lineWith = (...needles: string[]): string | undefined =>
  lines.find((l) => needles.every((n) => l.includes(n)));

describe("chroma wrapper source", () => {
  test("the PersistentClient patch precedes the first `from mempalace` import", () => {
    const patch = firstLine(/_chromadb\.PersistentClient/);
    const imported = firstLine(/^from mempalace/);
    assert.ok(patch > 0, "no _chromadb.PersistentClient assignment found");
    assert.ok(imported > 0, "no `from mempalace` import found");
    assert.ok(
      patch < imported,
      `patch (L${patch}) is not before the mempalace import (L${imported})`,
    );
  });

  test("the wrapper carries the chromadb version pin comment", () => {
    assert.match(wrapper, /Requires: chromadb>=/);
  });

  test("the max-connections variable carries its literal default 8", () => {
    const line = lineWith("MEMPALACE_CHROMA_MAX_CONNECTIONS", "os.environ.get");
    assert.ok(line !== undefined, "no MEMPALACE_CHROMA_MAX_CONNECTIONS os.environ.get() line");
    assert.ok(line.includes('"8"'), `default 8 missing: ${line}`);
  });

  test("the max-keepalive variable carries its literal default 4", () => {
    const line = lineWith("MEMPALACE_CHROMA_MAX_KEEPALIVE_CONNECTIONS", "os.environ.get");
    assert.ok(line !== undefined, "no MEMPALACE_CHROMA_MAX_KEEPALIVE_CONNECTIONS line");
    assert.ok(line.includes('"4"'), `default 4 missing: ${line}`);
  });

  test("settings= is applied at both HttpClient call sites", () => {
    const probe = lineWith("_probe = _chromadb.HttpClient(");
    const factory = lineWith("_cached_client = _chromadb.HttpClient(");
    assert.ok(probe !== undefined, "no `_probe = _chromadb.HttpClient(` line");
    assert.ok(factory !== undefined, "no `_cached_client = _chromadb.HttpClient(` line");
    assert.ok(probe.includes("settings="), `probe lacks settings=: ${probe}`);
    assert.ok(factory.includes("settings="), `factory lacks settings=: ${factory}`);
  });
});

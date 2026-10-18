// chroma-fd-limits.test.ts — spec 0029 R1-R3: both shipped ChromaDB supervisor
// units declare an open-file floor of 65536 (launchd soft and hard
// NumberOfFiles, systemd LimitNOFILE). Static reads of two git-tracked files
// under config/; no HOME, service manager, network or external command is
// involved, so no scratch HOME is needed. Retires test-chroma-fd-limits.sh
// (spec 0263). Runs on every platform (CRLF tolerant).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { REPO } from "./lib/chroma-stand-in.ts";

const FLOOR = 65536;
const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), "utf8");

/** The first `<integer>` after the first NumberOfFiles key that follows `key`. */
function plistLimit(text: string, key: string): number | undefined {
  const at = text.indexOf(`<key>${key}</key>`);
  if (at < 0) return undefined;
  const m = /<key>NumberOfFiles<\/key>\s*<integer>(\d+)<\/integer>/.exec(text.slice(at));
  return m?.[1] === undefined ? undefined : Number(m[1]);
}

describe("chroma launchd plist", () => {
  const plist = read("config/launchd/com.mempalace.chroma-server.plist");
  const soft = plistLimit(plist, "SoftResourceLimits");
  const hard = plistLimit(plist, "HardResourceLimits");

  test(`launchd SoftResourceLimits NumberOfFiles >= ${FLOOR}`, () => {
    assert.ok(soft !== undefined && soft >= FLOOR, `got ${soft ?? "<absent>"}`);
  });
  test(`launchd HardResourceLimits NumberOfFiles >= ${FLOOR}`, () => {
    assert.ok(hard !== undefined && hard >= FLOOR, `got ${hard ?? "<absent>"}`);
  });
  test("launchd hard limit >= soft limit", () => {
    assert.ok(soft !== undefined && hard !== undefined, `soft=${soft} hard=${hard}`);
    assert.ok(hard >= soft, `${hard} < ${soft}`);
  });
});

describe("chroma systemd unit", () => {
  test(`LimitNOFILE >= ${FLOOR} (the last assignment wins)`, () => {
    const all = [
      ...read("config/systemd/mempalace-chroma-server.service").matchAll(
        /^[ \t]*LimitNOFILE=(\d+)/gm,
      ),
    ];
    const last = all.at(-1)?.[1];
    assert.ok(last !== undefined && Number(last) >= FLOOR, `got ${last ?? "<absent>"}`);
  });
});

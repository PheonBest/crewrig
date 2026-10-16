// sequence-matcher.test.ts — pins scripts/lib/sequence-matcher.ts against reference
// values produced once by CPython `difflib.SequenceMatcher(None, a, b).ratio()`
// (the test itself never runs Python). Long inputs exercise the autojunk rule.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { parseTesseractTsv } from "../lib/governance/tesseract-tsv.ts";
import { ratio } from "../lib/sequence-matcher.ts";

/** Deterministic lowercase text, the same generator the references were made with. */
function alpha(step: number, n: number): string {
  let out = "";
  for (let i = 0; i < n; i++) out += String.fromCharCode(97 + ((i * step) % 26));
  return out;
}

const CASES: [string, string, number][] = [
  ["", "", 1.0],
  ["", "abc", 0.0],
  ["abc", "", 0.0],
  ["abc", "abc", 1.0],
  ["abcd", "bcde", 0.75],
  ["ab", "ba", 0.5],
  ["abcdef", "badcfe", 0.5],
  ["aaaa", "aa", 0.6666666666666666],
  ["aaaa", "aaaaaa", 0.8],
  ["abab", "baba", 0.75],
  ["abcabc", "abc", 0.6666666666666666],
  ["night", "nacht", 0.6],
  ["kitten", "sitting", 0.6153846153846154],
  ["claude code", "claud code", 0.9523809523809523],
  ["h\u00e9llo w\u00f6rld", "hello world", 0.8181818181818182],
  [
    "\u65e5\u672c\u8a9e\u30c6\u30ad\u30b9\u30c8",
    "\u65e5\u672c\u30c6\u30ad\u30b9\u30c8\u8a9e",
    0.8571428571428571,
  ],
  [
    "\ud83d\ude00\ud83d\ude01\ud83d\ude02",
    "\ud83d\ude02\ud83d\ude01\ud83d\ude00",
    0.3333333333333333,
  ],
  ["a\ud83d\ude00b", "a b", 0.6666666666666666],
  ["tesseract", "tesseract ocr", 0.8181818181818182],
  ["gemini cli", "gemini", 0.75],
  ["the quick brown fox", "the quick brown dog", 0.8947368421052632],
  ["word", "ward", 0.75],
  ["sequence", "sequential", 0.6666666666666666],
  ["abcxabc", "abcyabc", 0.8571428571428571],
  ["xabcabcy", "abcabc", 0.8571428571428571],
  ["ababab", "bababa", 0.8333333333333334],
  ["mississippi", "missouri", 0.5263157894736842],
  ["aabbcc", "ccbbaa", 0.3333333333333333],
  ["lewenstein", "levenshtein", 0.8571428571428571],
  ["   ", "  ", 0.8],
  ["a\u0301", "\u00e1", 0.0],
  ["one two three", "three two one", 0.5384615384615384],
  ["abcdefghij".repeat(25), "abcdefghij".repeat(24) + "xyz", 0.973630831643002],
  ["a".repeat(210), "a".repeat(100) + "b".repeat(110), 0.47619047619047616],
  ["ab".repeat(120), "ba".repeat(120), 0.0],
  [alpha(7, 260), alpha(11, 250), 0.00392156862745098],
  ["xy" + "a".repeat(205) + "z", "a".repeat(205) + "xyz", 0.014423076923076924],
  [
    "lorem ipsum dolor sit amet ".repeat(10),
    "lorem ipsum dolor sat amet ".repeat(9),
    0.07407407407407407,
  ],
  [alpha(3, 400), alpha(5, 400), 0.0025],
];

describe("ratio", () => {
  CASES.forEach(([a, b, expected], index) => {
    test(`matches difflib for case ${index}`, () => {
      assert.equal(ratio(a, b), expected);
    });
  });

  test("is 1.0 for two empty strings and for equal strings", () => {
    assert.equal(ratio("", ""), 1.0);
    assert.equal(ratio("same", "same"), 1.0);
  });
});

describe("parseTesseractTsv", () => {
  const row = (level: string, text: string, cols = 12): string => {
    const cells = [level, "1", "1", "1", "1", "1", "10", "20", "30", "40", "96", text];
    return cells.slice(0, cols).join("\t");
  };

  test("skips the header, keeps level-5 rows with text, computes geometry", () => {
    const out = ["header", row("4", "line"), row("5", "Claude"), row("5", "  "), row("5", "x", 11)];
    assert.deepEqual(parseTesseractTsv(out.join("\n") + "\n"), [
      { left: 10, top: 20, right: 40, bottom: 60, text: "Claude" },
    ]);
  });

  test("splits lines like Python splitlines and keeps raw text", () => {
    const words = parseTesseractTsv(`h\r\n${row("5", " a ")}\r${row("5", "b")}`);
    assert.deepEqual(
      words.map((w) => w.text),
      [" a ", "b"],
    );
    assert.deepEqual(parseTesseractTsv(""), []);
  });

  test("throws on a non-integer geometry cell", () => {
    const bad = row("5", "w").replace("\t10\t", "\tten\t");
    assert.throws(() => parseTesseractTsv(`h\n${bad}`));
  });
});

// classify.ts — the GitHub release-PR flow's per-extension decision (issue #1379). Port of
// release_classify, from the engine's dry run on the branch head and the extension's committed
// package.json version:
//   unchanged — the engine computes no release;
//   publish   — the committed version already IS the computed next version: a release PR
//               carrying that bump has been merged, so the release is tagged and published now;
//   pending   — the computed version is not committed yet: it goes into the release PR.
// A published extension is never also pending.

export type Classification = "unchanged" | "publish" | "pending";

export function classify(
  released: string,
  nextVersion: string,
  manifestVersion: string,
): Classification {
  if (released !== "true") return "unchanged";
  return nextVersion === manifestVersion ? "publish" : "pending";
}

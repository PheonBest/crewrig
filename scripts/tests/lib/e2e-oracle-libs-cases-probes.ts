// e2e-oracle-libs-cases-probes.ts — library cases of the probe resolvers and the ephemeral Copilot
// home (spec 0261 R9, PLAN v3 PR 2 Table 1). Inventory: scripts/tests/test-e2e-probes.sh sections
// 6, 8, 9 and 14 (probe A truth table and its 3-boolean loop, probe B rows, probe C cells C1..C4,
// the ephemeral-home staging helper). Every case is recorded from the unchanged shell libraries.

import type { LibCase } from "./e2e-oracle-libs-types.ts";

const LIB = "tests/e2e/lib";
const BOOLS = ["true", "false"] as const;
const tag = (v: string) => (v === "true" ? "t" : "f");

// Every combination of `n` booleans, "true" first, in nested-loop order.
function combos(n: number): string[][] {
  if (n === 0) return [[]];
  return combos(n - 1).flatMap((rest) => BOOLS.map((b) => [b, ...rest]));
}

const probeA: LibCase[] = combos(5).map((args) => ({
  id: `probes/a-${args.map(tag).join("")}`,
  lib: `${LIB}/probe_a_resolve.sh`,
  fn: "e2e_probe_a_resolve",
  args,
}));

const probeB: LibCase[] = combos(2).map((args) => ({
  id: `probes/b-${args.map(tag).join("")}`,
  lib: `${LIB}/probe_b_resolve.sh`,
  fn: "e2e_probe_b_resolve_cell",
  args,
}));

const probeCCells: LibCase[] = ["c1", "c2"].flatMap((cell) =>
  combos(4).map((args) => ({
    id: `probes/c-${cell}-${args.map(tag).join("")}`,
    lib: `${LIB}/probe_c_resolve.sh`,
    fn: `e2e_probe_c_resolve_${cell}`,
    args,
  })),
);

// c3 and c4 are one-line delegations to e2e_probe_c_resolve_guidance: the same rows are recorded
// through the three entry points. Args: baseline, target nonce, responded, observed, requested, control.
const GUIDANCE: ReadonlyArray<readonly [string, string[]]> = [
  ["baseline-absent", ["false", "true", "true", "haiku", "haiku", "sonnet"]],
  ["baseline-absent-no-nonce", ["false", "false", "false", "", "haiku", "sonnet"]],
  ["nonce-missing-failed", ["true", "false", "false", "", "haiku", "sonnet"]],
  ["nonce-missing-responded", ["true", "false", "true", "haiku", "haiku", "sonnet"]],
  ["no-model-label", ["true", "true", "true", "", "haiku", "sonnet"]],
  ["honoured", ["true", "true", "true", "haiku", "haiku", "sonnet"]],
  ["honoured-substring", ["true", "true", "true", "claude-haiku-4-5", "haiku", "sonnet"]],
  ["honoured-case-insensitive", ["true", "true", "true", "HAIKU", "haiku", "sonnet"]],
  ["honoured-requested-upper", ["true", "true", "true", "haiku", "HAIKU", "sonnet"]],
  [
    "honoured-agy",
    [
      "true",
      "true",
      "true",
      "gemini-3.8-flash-low",
      "gemini-3.8-flash-low",
      "gemini-3.8-flash-high",
    ],
  ],
  ["ignored-control", ["true", "true", "true", "sonnet", "haiku", "sonnet"]],
  ["ignored-control-substring", ["true", "true", "true", "claude-sonnet-4-6", "haiku", "sonnet"]],
  ["ignored-no-control", ["true", "true", "true", "sonnet", "haiku", ""]],
  ["ignored-other-model", ["true", "true", "true", "opus", "haiku", "sonnet"]],
  [
    "ignored-agy",
    [
      "true",
      "true",
      "true",
      "gemini-3.8-flash-high",
      "gemini-3.8-flash-low",
      "gemini-3.8-flash-high",
    ],
  ],
  ["empty-requested", ["true", "true", "true", "haiku", "", "sonnet"]],
  ["responded-false-with-nonce", ["true", "true", "false", "haiku", "haiku", "sonnet"]],
  ["non-literal-true", ["TRUE", "true", "true", "haiku", "haiku", "sonnet"]],
];

const probeCGuidance: LibCase[] = ["guidance", "c3", "c4"].flatMap((entry) =>
  GUIDANCE.map(([name, args]) => ({
    id: `probes/c-${entry}-${name}`,
    lib: `${LIB}/probe_c_resolve.sh`,
    fn: entry === "guidance" ? "e2e_probe_c_resolve_guidance" : `e2e_probe_c_resolve_${entry}`,
    args,
  })),
);

// Non-literal booleans. Missing-argument calls are not recorded: `set -o nounset` names the
// absolute library path in stderr, which the observer does not normalise (reported to the lead).
const edges: LibCase[] = [
  {
    id: "probes/a-missing-args",
    lib: `${LIB}/probe_a_resolve.sh`,
    fn: "e2e_probe_a_resolve",
    args: ["true", "false", "true", "false"],
  },
  {
    id: "probes/b-missing-args",
    lib: `${LIB}/probe_b_resolve.sh`,
    fn: "e2e_probe_b_resolve_cell",
    args: ["false"],
  },
  {
    id: "probes/c-c1-missing-args",
    lib: `${LIB}/probe_c_resolve.sh`,
    fn: "e2e_probe_c_resolve_c1",
    args: ["true", "true", "true"],
  },
  {
    id: "probes/c-guidance-missing-args",
    lib: `${LIB}/probe_c_resolve.sh`,
    fn: "e2e_probe_c_resolve_guidance",
    args: ["true", "true", "true", "haiku", "haiku"],
  },
  {
    id: "probes/home-stage-missing-args",
    lib: `${LIB}/copilot_ephemeral_home.sh`,
    fn: "e2e_stage_copilot_ephemeral_home",
    args: ["bundle"],
  },
  {
    id: "probes/home-mount-missing-args",
    lib: `${LIB}/copilot_ephemeral_home.sh`,
    fn: "e2e_copilot_home_mount_override",
    args: [],
  },
  {
    id: "probes/a-non-literal-true",
    lib: `${LIB}/probe_a_resolve.sh`,
    fn: "e2e_probe_a_resolve",
    args: ["TRUE", "false", "true", "false", "true"],
  },
  {
    id: "probes/a-empty-args",
    lib: `${LIB}/probe_a_resolve.sh`,
    fn: "e2e_probe_a_resolve",
    args: ["", "", "", "", ""],
  },
  {
    id: "probes/b-non-literal-true",
    lib: `${LIB}/probe_b_resolve.sh`,
    fn: "e2e_probe_b_resolve_cell",
    args: ["yes", "true"],
  },
  {
    id: "probes/c-c2-responded-non-literal",
    lib: `${LIB}/probe_c_resolve.sh`,
    fn: "e2e_probe_c_resolve_c2",
    args: ["true", "false", "no", "false"],
  },
];

// copilot_ephemeral_home.sh stages under `mktemp -d "${TMPDIR:-/tmp}/crewrig-e2e-copilot-home.XXXXXX"`:
// the six random characters survive the observer's normaliser (it names the sandbox root only), and
// the staging root sits outside `work/`. A shell wrapper passed to `eval` (fn: "eval") therefore calls the
// real function, then prints the staging root relative to its prefix with the random suffix
// replaced by <RAND> and lists the staged tree (type, mode) and the declaration copy. The wrapper
// text is part of the case args, so it is part of the recorded input; it only observes, the function under
// test is the unchanged library function.
const WRAP = `e2e_oracle_stage() {
  local s rc=0 name
  s="$(e2e_stage_copilot_ephemeral_home "$@")" || rc=$?
  printf 'rc=%s\\n' "$rc"
  [ -n "$s" ] || return "$rc"
  name="$(basename "$s")"
  printf 'parent=%s\\n' "$(dirname "$s")"
  printf 'name=%s\\n' "\${name%\${name#crewrig-e2e-copilot-home.}}<RAND:\${#name}>"
  (cd "$s" && find . -printf '%p %y %m\\n' | LC_ALL=C sort)
  if [ -f "$s/agents/$2.md" ]; then printf 'decl=<'; cat "$s/agents/$2.md"; printf '>\\n'; fi
  rm -rf "$s"
}
`;
const HOME_LIB = `${LIB}/copilot_ephemeral_home.sh`;
const stage = (...a: string[]) => `${WRAP}e2e_oracle_stage ${a.join(" ")}`;

const bundleSeed = [
  { path: "bundle/config.json", content: '{"k":1}\n', mode: 0o644 },
  { path: "bundle/sub/token", content: "secret\n", mode: 0o666 },
  { path: "bundle/agents/stale.md", content: "stale\n", mode: 0o644 },
  { path: "decl.md", content: "---\nname: probe\n---\nbody\n" },
] as const;

const home: LibCase[] = [
  {
    id: "probes/home-stage-bundle",
    lib: HOME_LIB,
    fn: "eval",
    args: [stage("bundle", "probe", "decl.md")],
    seed: [...bundleSeed],
    tools: ["find"],
  },
  {
    id: "probes/home-stage-no-bundle",
    lib: HOME_LIB,
    fn: "eval",
    args: [stage("no-such-bundle", "probe", "decl.md")],
    seed: [bundleSeed[3]],
    tools: ["find"],
  },
  {
    id: "probes/home-stage-decl-overrides-bundle-agent",
    lib: HOME_LIB,
    fn: "eval",
    args: [stage("bundle", "stale", "decl.md")],
    seed: [...bundleSeed],
    tools: ["find"],
  },
  {
    id: "probes/home-stage-decl-missing",
    lib: HOME_LIB,
    fn: "eval",
    args: [stage("bundle", "probe", "no-such-decl.md")],
    seed: [...bundleSeed],
    tools: ["find"],
  },
  {
    id: "probes/home-stage-mktemp-fails",
    lib: HOME_LIB,
    fn: "eval",
    args: [stage("bundle", "probe", "decl.md")],
    env: { TMPDIR: "{WORK}/no-such-tmp" },
    seed: [...bundleSeed],
    tools: ["find"],
  },
  {
    id: "probes/home-mount-default-mode",
    lib: HOME_LIB,
    fn: "e2e_copilot_home_mount_override",
    args: ["/tmp/x/home"],
  },
  {
    id: "probes/home-mount-ro",
    lib: HOME_LIB,
    fn: "e2e_copilot_home_mount_override",
    args: ["/tmp/x/home", "ro"],
  },
  {
    id: "probes/home-mount-empty-mode",
    lib: HOME_LIB,
    fn: "e2e_copilot_home_mount_override",
    args: ["/tmp/x/home", ""],
  },
  {
    id: "probes/home-mount-space-in-path",
    lib: HOME_LIB,
    fn: "e2e_copilot_home_mount_override",
    args: ["/tmp/a b/home", "rw"],
  },
];

export const cases: LibCase[] = [
  ...probeA,
  ...probeB,
  ...probeCCells,
  ...probeCGuidance,
  ...edges,
  ...home,
];

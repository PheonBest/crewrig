// runner-args.ts — argument parsing and usage text of the e2e runner (twin of the option loop of
// tests/e2e/run.sh). Pure: it returns either the parsed options or the exit the shell would take.

export interface RunnerOptions {
  readonly scenario: string;
  readonly cliFilter: string;
  readonly reportDir: string;
  readonly keep: string;
  readonly dryRun: boolean;
}

export interface EarlyExit {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

export const USAGE = `Usage: tests/e2e/run.sh [options]

Options:
  --scenario <name>         Limit to one scenario (default: all).
  --cli <claude|gemini|copilot|all>
                            Limit to one CLI (default: all configured).
  --report <tap>            Report format (default: tap; v1 only supports tap).
  --report-dir <path>       Override the report directory.
  --keep <N>                Keep at most N most-recent report dirs (default: 20).
  --dry-run                 Resolve config + write effective.json; do not spawn containers.
  -h, --help                Show this help.

The runner exits 0 on success or when no scenarios are defined. It exits
non-zero only if at least one scenario fails (TAP \`not ok\`).
`;

const die = (msg: string): EarlyExit => ({ status: 1, stdout: "", stderr: `ERROR: ${msg}\n` });

/** Parse argv (without the program name); an `EarlyExit` is what the shell printed before exiting. */
export function parseArgs(argv: readonly string[]): RunnerOptions | EarlyExit {
  let scenario = "";
  let cliFilter = "";
  let reportFormat = "tap";
  let reportDir = "";
  let keep = "20";
  let dryRun = false;
  for (let i = 0; i < argv.length;) {
    const arg = argv[i] as string;
    const takesValue = ["--scenario", "--cli", "--report", "--report-dir", "--keep"].includes(arg);
    if (takesValue && i + 1 >= argv.length) {
      return { status: 1, stdout: "", stderr: `run.sh: $2: unbound variable\n` };
    }
    const value = argv[i + 1] as string;
    if (arg === "--scenario") scenario = value;
    else if (arg === "--cli") cliFilter = value;
    else if (arg === "--report") reportFormat = value;
    else if (arg === "--report-dir") reportDir = value;
    else if (arg === "--keep") keep = value;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "-h" || arg === "--help") return { status: 0, stdout: USAGE, stderr: "" };
    else return { status: 2, stdout: "", stderr: `ERROR: unknown argument: ${arg}\n\n${USAGE}` };
    i += takesValue ? 2 : 1;
  }
  if (reportFormat !== "tap") {
    return die(`report format '${reportFormat}' is not supported in v1 (tap only).`);
  }
  if (cliFilter === "all") cliFilter = "";
  if (!["", "claude", "gemini", "copilot"].includes(cliFilter)) {
    return die(`--cli must be one of: claude, gemini, copilot, all (got '${cliFilter}').`);
  }
  return { scenario, cliFilter, reportDir, keep, dryRun };
}

export const isEarlyExit = (v: RunnerOptions | EarlyExit): v is EarlyExit => "status" in v;

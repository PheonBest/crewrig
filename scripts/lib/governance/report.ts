// report.ts — the only place that decides which stream a governance line goes to
// (spec 0259), so a stream mistake lives in one function.
//
// Usage: ok(line) / fail(line) / fatal(line)
//   ok     stdout  a passing or informational line
//   fail   stdout  a finding line (findings travel on stdout)
//   fatal  stderr  an error line, only where a script says so
// Exit codes: not applicable (library); callers set `process.exitCode`.
// Finding-line format: defined by each calling script.

/** Write a passing or informational line to standard output. */
export function ok(line: string): void {
  process.stdout.write(`${line}\n`);
}

/** Write a finding line to standard output. */
export function fail(line: string): void {
  process.stdout.write(`${line}\n`);
}

/** Write an error line to standard error. */
export function fatal(line: string): void {
  process.stderr.write(`${line}\n`);
}

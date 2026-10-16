// Shared shapes of the extension-hook probe modules (spec 0261): the probe never reads
// process.env or process.cwd(); the entry hands in the environment, the cwd and two sinks.

export type Env = Readonly<Record<string, string>>;

export interface Sinks {
  /** Text for stdout, written verbatim. */
  readonly out: (text: string) => void;
  /** Text for stderr, written verbatim. */
  readonly err: (text: string) => void;
}

export interface ProbeContext extends Sinks {
  readonly env: Env;
  readonly cwd: string;
}

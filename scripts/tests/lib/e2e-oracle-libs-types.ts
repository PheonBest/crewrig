// e2e-oracle-libs-types.ts — shape of a library case of the end-to-end harness oracle (spec 0261
// R9). A case names a shell library file, one function in it and its inputs; the recorder runs it
// through the shell and stores the Tuple. A later pull request binds the same case to the
// TypeScript twin (`scripts/tests/lib/e2e-oracle-libs-ts.ts`), so a case never mentions TypeScript.

export interface LibSeedFile {
  /** Path relative to the case's scratch `work/` directory. */
  readonly path: string;
  readonly content: string;
  readonly mode?: number;
}

export interface LibCase {
  /** `<group>/<name>`, kebab-case, unique across the registry. */
  readonly id: string;
  /** Library path relative to the repository root, e.g. `tests/e2e/lib/mask_command.sh`. */
  readonly lib: string;
  /** Shell function to call after sourcing the library (ignored when `script` is true). */
  readonly fn: string;
  /** Run the file as a script (`bash <lib> args`) instead of sourcing it: toml_merge, report. */
  readonly script?: boolean;
  readonly args?: readonly string[];
  /** Variables printed on stdout (`VAR=value`, after the function's own output) once it returns. */
  readonly printVars?: readonly string[];
  readonly stdin?: string;
  /** Paths relative to `work/` whose mode (file or directory, octal, or `absent`) is recorded after the call. */
  readonly statPaths?: readonly string[];
  /** Extra environment; `{WORK}` in a value is replaced by the scratch `work/` directory. */
  readonly env?: Readonly<Record<string, string>>;
  readonly seed?: readonly LibSeedFile[];
  /** Tool names the case may use besides bash itself (`jq`, `git`, `docker` stand-in is separate). */
  readonly tools?: readonly string[];
  /** Install the Docker stand-in first on PATH and make any `docker run` fail (auth-common). */
  readonly forbidDockerRun?: boolean;
}

export interface LibTuple {
  readonly id: string;
  readonly rc: number;
  readonly stdout: string;
  readonly stderr: string;
  /** Every file under `work/` after the call, relative path -> text (latin1), modes as octal. */
  readonly files: Readonly<Record<string, { readonly content: string; readonly mode: string }>>;
  /** Modes asked for by `statPaths`. */
  readonly stats: Readonly<Record<string, string>>;
}

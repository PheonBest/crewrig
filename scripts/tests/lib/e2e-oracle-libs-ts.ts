// e2e-oracle-libs-ts.ts — bind the library cases recorded from the shell (spec 0261 R9, R10) to the
// TypeScript twins. A binding runs the twin the way the shell function ran: same arguments, same
// scratch `work/` directory as its working directory, same environment (never `process.env`), same
// standard input; it returns what the shell function would have written and returned. Twins never
// read `process.env` or `process.cwd()` directly: they take `ctx`, which is what lets the oracle
// run them in a sandbox and what a Windows run depends on.

import type { LibCase, LibTuple } from "./e2e-oracle-libs-types.ts";
import { finishSandbox, makeSandbox } from "./e2e-oracle-libs-observe.ts";
import { bindings as assertBindings } from "./e2e-oracle-libs-ts-assert.ts";
import { bindings as authBindings } from "./e2e-oracle-libs-ts-auth.ts";
import { bindings as markerBindings } from "./e2e-oracle-libs-ts-markers.ts";
import { bindings as probeBindings } from "./e2e-oracle-libs-ts-probes.ts";
import { bindings as tomlBindings } from "./e2e-oracle-libs-ts-toml.ts";

export interface BindContext {
  /** Working directory of the call: the case's scratch `work/`. */
  readonly work: string;
  /** The environment the shell function saw. */
  readonly env: Readonly<Record<string, string>>;
  readonly stdin: string;
}

export interface BindResult {
  readonly rc: number;
  readonly stdout?: string;
  readonly stderr?: string;
  /** Values of the variables a case asks to print (`printVars`), as the shell would have set them. */
  readonly vars?: Readonly<Record<string, string>>;
}

export type Binding = (
  args: readonly string[],
  ctx: BindContext,
) => BindResult | Promise<BindResult>;

export const bindings: Readonly<Record<string, Binding>> = {
  ...assertBindings,
  ...authBindings,
  ...markerBindings,
  ...probeBindings,
  ...tomlBindings,
};

/** `<lib>#<fn>` for a sourced function, `<lib>` for a script; a case id wins over both. */
export function bindingFor(c: LibCase): Binding | undefined {
  return bindings[c.id] ?? bindings[c.script === true ? c.lib : `${c.lib}#${c.fn}`];
}

/** Run a case through its TypeScript twin; `null` when no binding exists yet. */
export async function observeLibTs(c: LibCase): Promise<LibTuple | null> {
  const binding = bindingFor(c);
  if (binding === undefined) return null;
  const box = makeSandbox(c);
  const res = await binding(c.args ?? [], { work: box.work, env: box.env, stdin: c.stdin ?? "" });
  // A call that exits (e2e_die, e2e_skip) never reaches the lines that print the variables.
  const printed =
    res.vars === undefined
      ? ""
      : (c.printVars ?? []).map((v) => `${v}=${res.vars?.[v] ?? ""}\n`).join("");
  return finishSandbox(c, box, {
    rc: res.rc,
    stdout: (res.stdout ?? "") + printed,
    stderr: res.stderr ?? "",
  });
}

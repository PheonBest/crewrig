// e2e-oracle-libs-ts-auth.ts — bindings of the auth-common library cases to their TypeScript twin.
// The goldens are the shell's bytes read back as latin1, so the twin's UTF-8 output (its `…` and
// `—`) is handed back as the latin1 view of its bytes.

import {
  type CallResult,
  e2eAssertBundleModes,
  e2eAuthReady,
  e2eChownBootstrap,
  e2eCliDir,
  e2eDie,
  e2eE2eHome,
  e2eEnsureBundleDir,
  e2eInfo,
  e2eRequireDocker,
  e2eRequireImage,
  e2eSkip,
  ExitError,
  makeDockerRunner,
} from "../../e2e/lib/auth-common.ts";
import type { Binding, BindResult } from "./e2e-oracle-libs-ts.ts";

const LIB = "scripts/e2e/lib/auth-common.sh";
const bytes = (s: string): string => Buffer.from(s, "utf8").toString("latin1");

const wrap =
  (
    call: (
      args: readonly string[],
      env: Readonly<Record<string, string>>,
      work: string,
    ) => CallResult,
  ): Binding =>
  (args, ctx): BindResult => {
    try {
      const r = call(args, ctx.env, ctx.work);
      return {
        rc: r.rc,
        stdout: bytes(r.stdout),
        stderr: bytes(r.stderr),
        vars: { E2E_AUTH_READY_CREDENTIAL_PATH: r.credentialPath ?? "" },
      };
    } catch (e) {
      if (e instanceof ExitError) return { rc: e.status, stderr: bytes(e.stderr) };
      throw e;
    }
  };

const line = (s: string): CallResult => ({ rc: 0, stdout: s, stderr: "" });

export const bindings: Record<string, Binding> = {
  [`${LIB}#e2e_die`]: wrap((a) => e2eDie(...a)),
  [`${LIB}#e2e_skip`]: wrap((a) => e2eSkip(...a)),
  [`${LIB}#e2e_info`]: wrap((a) => e2eInfo(...a)),
  [`${LIB}#e2e_require_docker`]: wrap((_a, env) => e2eRequireDocker(env)),
  [`${LIB}#e2e_require_image`]: wrap((a, env, work) =>
    e2eRequireImage(a[0] ?? "", a[1] ?? "", makeDockerRunner(env, work)),
  ),
  [`${LIB}#e2e_e2e_home`]: wrap((_a, env) => line(`${e2eE2eHome(env)}\n`)),
  [`${LIB}#e2e_cli_dir`]: wrap((a, env) => line(`${e2eCliDir(env, a[0] ?? "")}\n`)),
  [`${LIB}#e2e_ensure_bundle_dir`]: wrap((a, env) => e2eEnsureBundleDir(env, a[0] ?? "")),
  [`${LIB}#e2e_assert_bundle_modes`]: wrap((a, env) => e2eAssertBundleModes(env, a[0] ?? "")),
  [`${LIB}#e2e_chown_bootstrap`]: wrap((a, env) => e2eChownBootstrap(env, a[0] ?? "", a[1] ?? "")),
  [`${LIB}#e2e_auth_ready`]: wrap((a, env) => e2eAuthReady(env, a[0] ?? "")),
};

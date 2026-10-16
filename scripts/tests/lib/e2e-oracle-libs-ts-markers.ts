// e2e-oracle-libs-ts-markers.ts — bindings of the library cases of one group to their TypeScript twins.

import { maskCommandJson, maskCommandString } from "../../../tests/e2e/lib/mask_command.ts";
import { probeSpawnSignals } from "../../../tests/e2e/lib/probe_spawn_markers.ts";
import type { Binding } from "./e2e-oracle-libs-ts.ts";

export const bindings: Record<string, Binding> = {
  "tests/e2e/lib/mask_command.sh#e2e_mask_command_string": (args) => ({
    rc: 0,
    stdout: maskCommandString(args[0] ?? ""),
  }),
  "tests/e2e/lib/mask_command.sh#e2e_mask_command_json": (_args, ctx) => maskCommandJson(ctx.stdin),
  "tests/e2e/lib/probe_spawn_markers.sh#e2e_probe_spawn_signals": (args, ctx) => ({
    rc: 0,
    stdout: probeSpawnSignals(args[0] ?? "", args[1] ?? "", args[2] ?? "", ctx.work),
  }),
};

// mode.ts — publish or rehearsal (spec 0213, spec 0257 R13). Port of release_mode.
// RELEASE_DRY_RUN is canonical; DRY_RUN is an accepted alias. Either set to `true` selects the
// rehearsal, so `true` wins a conflict. Only `true`, `false` and empty are valid.

import { ReleaseRefusal } from "./refusal.ts";

export type ReleaseMode = "publish" | "rehearsal";

function checkValue(name: string, value: string): void {
  if (value !== "true" && value !== "false" && value !== "") {
    throw new ReleaseRefusal(`invalid ${name} value (expected true, false or empty)`);
  }
}

export function releaseMode(env: NodeJS.ProcessEnv): ReleaseMode {
  const canonical = env["RELEASE_DRY_RUN"] ?? "";
  const alias = env["DRY_RUN"] ?? "";
  checkValue("RELEASE_DRY_RUN", canonical);
  checkValue("DRY_RUN", alias);
  return canonical === "true" || alias === "true" ? "rehearsal" : "publish";
}

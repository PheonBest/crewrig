// e2e-oracle-libs-cases.ts — registry of the library cases (spec 0261 R9). Each group file exports
// `cases: LibCase[]`; keep this file to the aggregation only.

import type { LibCase } from "./e2e-oracle-libs-types.ts";
import { cases as assertAndStructural } from "./e2e-oracle-libs-cases-assert.ts";
import { cases as authCommon } from "./e2e-oracle-libs-cases-auth.ts";
import { cases as markers } from "./e2e-oracle-libs-cases-markers.ts";
import { cases as probeResolvers } from "./e2e-oracle-libs-cases-probes.ts";
import { cases as reportAndToml } from "./e2e-oracle-libs-cases-report.ts";

export const cases: readonly LibCase[] = [
  ...assertAndStructural,
  ...authCommon,
  ...markers,
  ...probeResolvers,
  ...reportAndToml,
];

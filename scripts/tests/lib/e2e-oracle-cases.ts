// e2e-oracle-cases.ts — the registry of end-to-end oracle cases (spec 0261 R5, R7, R8): the
// concatenation of the per-scenario-group modules, in a fixed order.

import { cases as cases0103 } from "./e2e-oracle-cases-01-03.ts";
import { cases as cases0204 } from "./e2e-oracle-cases-02-04.ts";
import { cases as cases0507 } from "./e2e-oracle-cases-05-07.ts";
import type { OracleCase } from "./e2e-oracle-types.ts";

export const cases: readonly OracleCase[] = [...cases0103, ...cases0204, ...cases0507];

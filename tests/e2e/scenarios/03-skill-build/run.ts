// scenarios/03-skill-build/run.ts — thin entry; the logic lives in lib/scenario-03-skill-build.ts.
import { runScenario03 } from "../../lib/scenario-03-skill-build.ts";

// The production closure of js-yaml, staged as real copies into the build tree.
const STAGED_PACKAGES = ["js-yaml", "argparse"];
const out = runScenario03(process.env, process.cwd(), STAGED_PACKAGES);
process.stdout.write(out.stdout);
process.stderr.write(out.stderr);
process.exitCode = out.status;

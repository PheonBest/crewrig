// usage-pricing-driver.ts — child-process driver of the usage-pricing suites (spec
// 0260, delta 01: a TypeScript driver, ported from the Bash suite's node heredoc).
// It runs in its own `node` per call so the CommonJS require cache of the library
// copy under test never leaks across cases. The checkout under test comes from
// USAGE_TEST_REPO_DIR; every other input is an argument or an environment variable
// read at call time. `make-record` and `period-of` live in the rig / are dropped.

/* oxlint-disable typescript/no-explicit-any, typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-call, typescript/no-unsafe-argument, typescript/no-unsafe-return -- the libraries are untyped CommonJS */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const repoDir = process.env["USAGE_TEST_REPO_DIR"];
if (!repoDir) {
  console.error("FATAL: USAGE_TEST_REPO_DIR not set");
  process.exit(2);
}
const nodeRequire = createRequire(path.join(repoDir, "driver.js"));
// The libraries are untyped CommonJS: the driver deliberately reads them as `any`.
const req = (rel: string): any => nodeRequire(path.join(repoDir, rel));

const envOr = (name: string, def: string): string => {
  const v = process.env[name];
  return v === undefined || v === "" ? def : v;
};
const readJson = (file: string): any => JSON.parse(fs.readFileSync(file, "utf8"));

function loadOrg(): { entries: object; copilot: object } {
  const orgFile = process.env["PRICE_ORG_FILE"];
  if (!orgFile) return { entries: {}, copilot: {} };
  const parsed = readJson(orgFile);
  return { entries: parsed.entries || {}, copilot: parsed.copilot || {} };
}

const arg = (i: number): string => process.argv[i] ?? "";

function writeFixing(fixing: { date: string }): void {
  const layout = req("scripts/lib/usage-store/layout.js");
  const dir = path.join(layout.fxDir(), "ecb");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${fixing.date}.json`), JSON.stringify(fixing));
}

const commands: Record<string, () => unknown> = {
  // pin <fixturesDir> — writes the pinned fixture price list into CREWRIG_USAGE_ROOT.
  pin() {
    const layout = req("scripts/lib/usage-store/layout.js");
    const blob = readJson(path.join(arg(3), "pricelist", "fixture.json"));
    const pointer = readJson(path.join(arg(3), "pricelist", "PINNED.json"));
    fs.mkdirSync(layout.pricelistDir(), { recursive: true });
    fs.writeFileSync(path.join(layout.pricelistDir(), `${pointer.sha}.json`), JSON.stringify(blob));
    fs.writeFileSync(layout.pinnedPointer(), JSON.stringify(pointer, null, 2));
    console.log(`PINNED sha=${pointer.sha}`);
  },
  // seed-fx <fixingFile> — copies a fixing fixture into the fx cache.
  "seed-fx"() {
    const fixing = readJson(arg(3));
    writeFixing(fixing);
    console.log(`SEEDED ${fixing.date}`);
  },
  write() {
    const result = req("scripts/lib/usage-store/journal.js").write(readJson(arg(3)));
    console.log(`STATUS=${result.status}`);
    if (result.reason) console.log(`REASON=${result.reason}`);
  },
  // compute-price <recordFile> — store.computePriceObject(): no cache, no write.
  "compute-price"() {
    const opts = { currency: envOr("PRICE_CURRENCY", "USD"), org: loadOrg() };
    return req("scripts/lib/usage-price/store.js")
      .computePriceObject(readJson(arg(3)), opts)
      .then((p: unknown) => process.stdout.write(JSON.stringify(p)));
  },
  // resolve-and-compute <recordFile> — resolve + computeUsd called directly, so the
  // per-component breakdown (`components`) stays visible.
  "resolve-and-compute"() {
    const record = readJson(arg(3));
    const snapshot = req("scripts/lib/usage-price/pricelist.js").pinned();
    const resolved = req("scripts/lib/usage-price/resolve.js").resolve(record.modelId, {
      pricelist: snapshot,
      org: loadOrg(),
    });
    if (resolved.unpriced) {
      process.stdout.write(
        JSON.stringify({ unpriced: true, step: resolved.step, reason: resolved.reason }),
      );
      return;
    }
    const computed = req("scripts/lib/usage-price/compute.js").computeUsd(record, resolved.entry);
    process.stdout.write(
      JSON.stringify({
        resolution: {
          step: resolved.step,
          entryKey: resolved.entryKey,
          family: resolved.family,
        },
        ...computed,
      }),
    );
  },
  // price-record <recordFile> — store.priceRecord(): the cache-aware read-through.
  "price-record"() {
    const opts = {
      currency: envOr("PRICE_CURRENCY", "USD"),
      asOfToday: process.env["PRICE_AS_OF_TODAY"] === "1",
      org: loadOrg(),
    };
    return req("scripts/lib/usage-price/store.js")
      .priceRecord(readJson(arg(3)), opts)
      .then((p: unknown) => process.stdout.write(JSON.stringify(p)));
  },
  resolve() {
    const snapshot = req("scripts/lib/usage-price/pricelist.js").pinned();
    const result = req("scripts/lib/usage-price/resolve.js").resolve(arg(3), {
      pricelist: snapshot,
      org: loadOrg(),
    });
    process.stdout.write(JSON.stringify(result));
  },
  // fx-resolve <date> — fx.resolve(date, ctx); FX_INJECT_SEED_FILE installs an
  // in-process, no-network fetcher that writes that one fixing and counts its calls.
  "fx-resolve"() {
    let calls = 0;
    const ctx: { fetchFixings?: () => Promise<object> } = {};
    const seed = process.env["FX_INJECT_SEED_FILE"];
    if (seed) {
      ctx.fetchFixings = async () => {
        calls += 1;
        writeFixing(readJson(seed));
        return { source: "injected", fixingsWritten: 1 };
      };
    }
    return req("scripts/lib/usage-price/fx.js")
      .resolve(arg(3), ctx)
      .then((r: unknown) => {
        console.log(JSON.stringify(r));
        console.log(`FETCHER_CALLS=${calls}`);
      });
  },
  rollup() {
    const period = process.argv[3];
    const cli = process.argv[4];
    return req("scripts/lib/usage-price/rollup.js")
      .rollup({ period, cli }, { combined: true })
      .then((r: unknown) => console.log(JSON.stringify(r)));
  },
  // plant-price <recordFile> <priceJsonFile> — a price file verbatim at the record's path.
  "plant-price"() {
    const layout = req("scripts/lib/usage-store/layout.js");
    const record = readJson(arg(3));
    const filePath = layout.priceEntry(
      record.provenance.cli,
      layout.period(record),
      record.recordId,
    );
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(readJson(arg(4)), null, 2));
    console.log(`PLANTED ${filePath}`);
  },
  // rollup-fetch-count <period> <currency> — two rollup() passes in ONE process with
  // the freshness gate live (OFFLINE deleted in-process) and a counting failing fetcher.
  async "rollup-fetch-count"() {
    delete process.env["CREWRIG_USAGE_OFFLINE"];
    const priceRollup = req("scripts/lib/usage-price/rollup.js");
    let calls = 0;
    const fetchFixings = async () => {
      calls += 1;
      throw new Error("injected network error");
    };
    const opts = { combined: true, currency: arg(4), ctx: { fetchFixings } };
    for (let pass = 1; pass <= 2; pass++) {
      calls = 0;
      console.log(JSON.stringify(await priceRollup.rollup({ period: arg(3) }, opts)));
      console.log(`FETCHER_CALLS=${calls}`);
    }
  },
};

const run = commands[arg(2)];
if (!run) {
  console.error(`unknown driver command: ${arg(2)}`);
  process.exit(2);
}
await run();

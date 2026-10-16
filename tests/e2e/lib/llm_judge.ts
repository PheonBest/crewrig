// tests/e2e/lib/llm_judge.ts — TypeScript twin of llm_judge.sh (spec 0261 R9, PLAN v3 PR 5).
//
// llmJudge(deps, promptFile, subjectFile, criterion) -> { status, stdout, stderr }: same stdout
// verdict line, same diagnostics, same exit statuses, same judge.count semantics, strict mode,
// 3-call quorum, max_calls cap, mock mode (E2E_JUDGE_MOCK) and preflight as the shell judge. Env,
// clock, sleep and fetch are injected; nothing here reads process.env. Node built-ins only.

import fs from "node:fs";

import { anthropicDriver } from "./llm_judge_drivers/anthropic.ts";
import { claudeCodeDriver } from "./llm_judge_drivers/claude-code.ts";
import { geminiDriver } from "./llm_judge_drivers/gemini.ts";
import { ollamaCloudDriver } from "./llm_judge_drivers/ollama-cloud.ts";

export interface JudgeDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly fetch?: typeof fetch;
}

export interface JudgeConfig {
  backend: string;
  model: string;
  apiKeyEnv: string;
  authMode: string;
  strict: boolean;
  maxCalls: number;
  endpoint: string;
  maxTokens: unknown;
  temperature: unknown;
  gcpProject: string;
}

export interface Ctx {
  readonly cfg: JudgeConfig;
  readonly deps: JudgeDeps;
  readonly mock: boolean;
  err(s: string): void;
  bump(): void;
}

export type Preflight = { rc: 0; token: string } | { rc: 1 | 2 };

export interface Driver {
  preflight(ctx: Ctx): Promise<Preflight>;
  /** The `VERDICT=<v> CONF=<c>` line, or undefined (malformed or persistent HTTP error). */
  call(
    ctx: Ctx,
    token: string,
    prompt: string,
    subject: string,
    criterion: string,
  ): Promise<string | undefined>;
}

export interface JudgeResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

const DEFAULT_ENDPOINT = "https://api.anthropic.com/v1/messages";

function driverFor(name: string): Driver | undefined {
  switch (name) {
    case "anthropic":
      return anthropicDriver;
    case "claude-code":
      return claudeCodeDriver;
    case "gemini":
      return geminiDriver;
    case "ollama-cloud":
      return ollamaCloudDriver;
    default:
      return undefined;
  }
}

function truncate(text: string): string {
  const s = text.replaceAll("\n", " ");
  return s.length > 200 ? `${s.slice(0, 200)}…` : s;
}

/** The `# FAIL` diagnostic block of assert.sh's `_e2e_assert_diag`. */
export function assertDiag(
  env: JudgeDeps["env"],
  name: string,
  expected: string,
  actual: string,
  artefact = "",
): string {
  const dir = env["E2E_REPORT_DIR"] ?? "";
  let report = "";
  if (dir !== "") report = `${dir}${artefact !== "" ? `/${artefact}` : ""}`;
  else if (artefact !== "") report = `<unset>/${artefact}`;
  return (
    `# FAIL ${name}\n#   expected: ${truncate(expected)}\n#   actual:   ${truncate(actual)}\n` +
    (report !== "" ? `#   report:   ${report}\n` : "")
  );
}

/** jq's `-r` rendering of a value, `""` for null/false (jq's `// empty`). */
export function str(v: unknown): string {
  if (v === undefined || v === null || v === false) return "";
  return typeof v === "string" ? v : JSON.stringify(v);
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export function dig(v: unknown, ...path: (string | number)[]): unknown {
  let cur = v;
  for (const k of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string | number, unknown>)[k];
  }
  return cur;
}

/** Octal permission string when any group/other bit is set (the 0177 mask), else undefined. */
export function unsafePerms(file: string): string | undefined {
  try {
    const mode = fs.statSync(file).mode & 0o777;
    return (mode & 0o177) !== 0 ? mode.toString(8) : undefined;
  } catch {
    return undefined;
  }
}

export function readable(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function loadConfig(env: JudgeDeps["env"]): JudgeConfig {
  const cfg: JudgeConfig = {
    backend: "anthropic",
    model: "claude-sonnet-4-6",
    apiKeyEnv: "ANTHROPIC_JUDGE_API_KEY",
    authMode: "api_key",
    strict: false,
    maxCalls: 30,
    endpoint: DEFAULT_ENDPOINT,
    maxTokens: 256,
    temperature: 0.0,
    gcpProject: "",
  };
  const dir = env["E2E_REPORT_DIR"] ?? "";
  const file = `${dir}/effective.json`;
  if (dir !== "" && fs.existsSync(file)) {
    const j = dig(parseJson(fs.readFileSync(file, "utf8")), "judge");
    const pick = (k: string, d: unknown): unknown => {
      const v = dig(j, k);
      return v === undefined || v === null || v === false ? d : v;
    };
    cfg.backend = str(pick("backend", cfg.backend));
    cfg.model = str(pick("model", cfg.model));
    cfg.apiKeyEnv = str(pick("api_key_env", cfg.apiKeyEnv));
    cfg.authMode = str(pick("auth_mode", cfg.authMode));
    cfg.strict = dig(j, "strict") === true || str(dig(j, "strict")) === "true";
    cfg.maxCalls = Number(str(pick("max_calls", 30))) || 0;
    cfg.endpoint = str(pick("endpoint", cfg.endpoint));
    cfg.maxTokens = pick("max_tokens", 256);
    cfg.temperature = dig(j, "temperature") ?? 0.0;
    cfg.gcpProject = str(dig(j, "gcp_project"));
  }
  if (env["E2E_JUDGE_STRICT"] === "1") cfg.strict = true;
  return cfg;
}

export async function llmJudge(
  deps: JudgeDeps,
  promptFile: string,
  subjectFile: string,
  criterion: string,
): Promise<JudgeResult> {
  let stdout = "";
  let stderr = "";
  const done = (status: number): JudgeResult => ({ status, stdout, stderr });
  const name = `llm_judge ${promptFile} ${subjectFile} ${criterion}`;
  const diag = (expected: string, actual: string, artefact = "") => {
    stderr += assertDiag(deps.env, name, expected, actual, artefact);
  };
  if (!fs.existsSync(promptFile))
    return (diag("<prompt-file> readable", `no such file: ${promptFile}`), done(1));
  if (!fs.existsSync(subjectFile))
    return (diag("<subject-file> readable", `no such file: ${subjectFile}`), done(1));

  const cfg = loadConfig(deps.env);
  const driver = driverFor(cfg.backend);
  if (driver === undefined) {
    const libDir = deps.env["E2E_LIB_DIR"] || "tests/e2e/lib";
    diag(
      `driver for backend=${cfg.backend} at ${libDir}/llm_judge_drivers/${cfg.backend}.sh`,
      "file not found",
    );
    return done(1);
  }
  const reportDir = deps.env["E2E_REPORT_DIR"] ?? "";
  const counter = reportDir === "" ? undefined : `${reportDir}/judge.count`;
  const readCount = (): number => {
    if (counter === undefined) return 0;
    try {
      return Number(fs.readFileSync(counter, "utf8").trim()) || 0;
    } catch {
      return 0;
    }
  };
  const mock = deps.env["E2E_JUDGE_MOCK"] === "1";
  const ctx: Ctx = {
    cfg,
    deps,
    mock,
    err: (s) => void (stderr += s),
    bump: () => {
      if (counter !== undefined) fs.writeFileSync(counter, `${readCount() + 1}\n`);
    },
  };

  const pf = await driver.preflight(ctx);
  if (pf.rc === 2) {
    stdout += "VERDICT=UNCERTAIN confidence=0.00\n";
    if (cfg.strict) {
      diag("judge credentials present (strict mode)", `backend=${cfg.backend} auth-missing`);
      return done(1);
    }
    stderr += `# WARN llm_judge UNCERTAIN reason=auth-missing backend=${cfg.backend}\n`;
    return done(0);
  }
  if (pf.rc !== 0) {
    diag(
      `preflight success for backend=${cfg.backend}`,
      `preflight returned hard failure (rc=${pf.rc})`,
    );
    return done(1);
  }

  const cur = readCount();
  if (cur >= cfg.maxCalls) {
    diag(
      `judge call count < ${cfg.maxCalls}`,
      `per-run cap exceeded (count=${cur}); see ${reportDir || "<unset>"}/judge.count`,
      "judge.count",
    );
    return done(1);
  }

  const cat = (f: string) => fs.readFileSync(f, "utf8").replace(/\n+$/, "");
  const prompt = cat(promptFile);
  const subject = cat(subjectFile);
  const slots: string[] = [];
  const confs: number[] = [];
  let pass = 0;
  let fail = 0;
  for (let i = 0; i < 3; i++) {
    const raw = await driver.call(ctx, pf.token, prompt, subject, criterion);
    if (raw !== undefined) {
      const v = /VERDICT=([A-Z]+)/.exec(raw)?.[1] ?? "";
      confs.push(Number(/CONF=(\d+(?:\.\d+)?)/.exec(raw)?.[1] ?? "0"));
      slots.push(v);
      if (v === "PASS") pass++;
      else if (v === "FAIL") fail++;
    } else {
      slots.push("UNCERTAIN");
      confs.push(0);
    }
    if (pass >= 2 || fail >= 2) break;
  }
  const verdict = pass >= 2 ? "PASS" : fail >= 2 ? "FAIL" : "UNCERTAIN";
  const mean = confs.length > 0 ? confs.reduce((a, b) => a + b, 0) / confs.length : 0;
  const confidence = mean.toFixed(2);
  stdout += `VERDICT=${verdict} confidence=${confidence}\n`;
  if (verdict === "PASS") return done(0);
  if (verdict === "FAIL") {
    diag("VERDICT=PASS", `VERDICT=FAIL confidence=${confidence}`);
    return done(1);
  }
  if (cfg.strict) {
    diag(
      "VERDICT=PASS (strict mode upgrades UNCERTAIN to FAIL)",
      `VERDICT=UNCERTAIN confidence=${confidence} (slots: ${slots.join(" ")})`,
    );
    return done(1);
  }
  stderr += `# WARN llm_judge UNCERTAIN confidence=${confidence} slots=${slots.join(" ")}\n`;
  return done(0);
}

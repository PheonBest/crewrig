// e2e-judge-endpoints.ts — a local HTTP stand-in for the four judge backends (spec 0261 R9).
//
// One `node:http` server on 127.0.0.1:0 answers every backend from a QUEUE of canned replies and
// records each request. How the shell judge is pointed at it, per driver:
//   anthropic    `[judge].endpoint` in effective.json  -> <base>/anthropic/v1/messages
//   claude-code  `[judge].endpoint`                    -> <base>/claude-code/v1/messages
//   gemini       `[judge].endpoint` (+ `?key=` in api_key mode) -> <base>/gemini/v1beta/models/m:generateContent
//   gemini oauth token refresh: URL hard-coded to https://oauth2.googleapis.com/token in the
//                driver, NOT overridable: the runner puts a `curl` shim on PATH that rewrites it to
//                <base>/gemini-token (see e2e-judge-run.ts).
//   ollama-cloud `[judge].endpoint` (or env OLLAMA_COMPLETIONS_ENDPOINT when the endpoint is empty
//                or the anthropic default) -> <base>/ollama-cloud/chat; token exchange: env
//                OLLAMA_TOKEN_ENDPOINT -> <base>/ollama-token.

import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

export type EndpointKey =
  | "anthropic"
  | "claude-code"
  | "gemini"
  | "gemini-token"
  | "ollama-cloud"
  | "ollama-token";

export const ENDPOINT_PATHS: Readonly<Record<EndpointKey, string>> = {
  anthropic: "/anthropic/v1/messages",
  "claude-code": "/claude-code/v1/messages",
  gemini: "/gemini/v1beta/models/judge:generateContent",
  "gemini-token": "/gemini-token",
  "ollama-cloud": "/ollama-cloud/chat",
  "ollama-token": "/ollama-token",
};

export interface CannedReply {
  readonly status?: number;
  /** A string is sent as is; anything else as JSON. */
  readonly body: unknown;
}

export interface RecordedRequest {
  readonly endpoint: EndpointKey | "unknown";
  readonly method: string;
  readonly path: string;
  readonly query: Record<string, string>;
  readonly headers: Record<string, string>;
  readonly authKind: "bearer" | "x-api-key" | "query-key" | "none";
  readonly body: unknown;
  /** True when the queue was empty and the stand-in answered 500. */
  readonly unqueued: boolean;
}

export interface JudgeEndpoints {
  start(): Promise<string>;
  queue(endpoint: EndpointKey, replies: readonly CannedReply[]): void;
  requests(): readonly RecordedRequest[];
  stop(): Promise<void>;
}

/** The reply a backend sends when the model answers `text`. */
export function replyFor(endpoint: EndpointKey, text: string): CannedReply {
  switch (endpoint) {
    case "anthropic":
    case "claude-code":
      return { body: { content: [{ type: "text", text }] } };
    case "gemini":
      return { body: { candidates: [{ content: { parts: [{ text }] } }] } };
    case "ollama-cloud":
      return { body: { choices: [{ message: { role: "assistant", content: text } }] } };
    default:
      return { body: { access_token: text } };
  }
}

const KEPT_HEADERS = ["content-type", "anthropic-version", "x-goog-user-project"];
const SECRET_FIELDS = new Set(["refresh_token", "client_secret"]);

function endpointOf(pathname: string): EndpointKey | "unknown" {
  for (const [key, p] of Object.entries(ENDPOINT_PATHS))
    if (p === pathname) return key as EndpointKey;
  return "unknown";
}

function redactJwt(assertion: string): unknown {
  const [h, p] = assertion.split(".");
  try {
    const dec = (s: string): Record<string, unknown> =>
      JSON.parse(Buffer.from(s ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
    return {
      header: dec(h ?? ""),
      payload: { ...dec(p ?? ""), iat: "<TS>", exp: "<TS>" },
      signature: "<SIGNATURE>",
    };
  } catch {
    return "<UNPARSEABLE-ASSERTION>";
  }
}

function redactBody(raw: string, contentType: string): unknown {
  if (contentType.startsWith("application/x-www-form-urlencoded")) {
    const out: Record<string, string> = {};
    for (const [k, v] of new URLSearchParams(raw)) out[k] = SECRET_FIELDS.has(k) ? "<REDACTED>" : v;
    return out;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed !== null && typeof parsed === "object" && "assertion" in parsed) {
      const rec = parsed as Record<string, unknown>;
      return { ...rec, assertion: redactJwt(String(rec["assertion"])) };
    }
    return parsed;
  } catch {
    return raw;
  }
}

export function createJudgeEndpoints(): JudgeEndpoints {
  const queues = new Map<EndpointKey, CannedReply[]>();
  const log: RecordedRequest[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const endpoint = endpointOf(url.pathname);
      const query: Record<string, string> = {};
      for (const [k, v] of url.searchParams) query[k] = k === "key" ? "<REDACTED>" : v;
      const headers: Record<string, string> = {};
      for (const name of KEPT_HEADERS) {
        const v = req.headers[name];
        if (typeof v === "string") headers[name] = v;
      }
      let authKind: RecordedRequest["authKind"] = "none";
      if (typeof req.headers["authorization"] === "string") {
        headers["authorization"] = "<REDACTED>";
        authKind = "bearer";
      } else if (typeof req.headers["x-api-key"] === "string") {
        headers["x-api-key"] = "<REDACTED>";
        authKind = "x-api-key";
      } else if ("key" in query) authKind = "query-key";
      const raw = Buffer.concat(chunks).toString("utf8");
      const reply = endpoint === "unknown" ? undefined : queues.get(endpoint)?.shift();
      log.push({
        endpoint,
        method: req.method ?? "",
        path: url.pathname,
        query,
        headers,
        authKind,
        body: redactBody(raw, headers["content-type"] ?? ""),
        unqueued: reply === undefined,
      });
      const status = reply === undefined ? 500 : (reply.status ?? 200);
      const body = reply === undefined ? { error: "stand-in queue empty" } : reply.body;
      res.writeHead(status, { "content-type": "application/json" });
      res.end(typeof body === "string" ? body : JSON.stringify(body));
    });
  });
  return {
    start: () =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () =>
          resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
        );
      }),
    queue(endpoint, replies) {
      queues.set(endpoint, [...(queues.get(endpoint) ?? []), ...replies]);
    },
    requests: () => [...log],
    stop: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** Stable short fingerprint for tests that need to tell two secrets apart without recording them. */
export function fingerprint(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex").slice(0, 8);
}

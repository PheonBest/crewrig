// usage-dashboard-serve.ts — form B of the usage dashboard: a `serve --port 0` child with its LISTENING /
// BOUND lines, raw HTTP requests (custom Host, headers and raw path), a foreign listener, the per-process
// POST token and the B renderings of a selection. A server is torn down through `POST /stop` and a
// check of the child handle (no `pgrep`): the entry spawns a grandchild node (usage-wrapper.ts runJs
// uses spawnSync), so a bare signal to the entry could orphan the listener (#1371); the fallback kills
// the whole process group (POSIX) or the tree (taskkill /T).

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import http from "node:http";
import path from "node:path";

import { REPO, type Sandbox } from "./usage-dashboard-rig.ts";
import { extractEmbedded } from "./usage-dashboard-checks.ts";
import { parseView, type View } from "./usage-dashboard-views.ts";

export interface Reply {
  readonly status: number | string;
  readonly headers: http.IncomingHttpHeaders;
  readonly body: string;
}
export interface HttpOptions {
  readonly headers?: Record<string, string>;
  readonly body?: string;
  /** The connect address (default 127.0.0.1); a `Host` header goes in `headers`. */
  readonly host?: string;
}

/** One raw HTTP request (the target is sent verbatim, Node does not normalise it) to <host>:<port>; a transport error becomes status = its error code. */
export function httpReq(
  method: string,
  port: number,
  target: string,
  options: HttpOptions = {},
): Promise<Reply> {
  return new Promise((resolve) => {
    const r = http.request(
      {
        host: options.host ?? "127.0.0.1",
        port,
        path: target,
        method,
        headers: options.headers ?? {},
        timeout: 15000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    r.on("error", (err: NodeJS.ErrnoException) =>
      resolve({ status: err.code ?? "ERROR", headers: {}, body: String(err.message) }),
    );
    r.on("timeout", () => r.destroy(new Error("timeout")));
    if (options.body !== undefined) r.write(options.body);
    r.end();
  });
}

/** The per-process POST token the served page carries (empty when absent). */
export function formToken(html: string): string {
  const m =
    /name="token"[^>]*value="([^"]+)"/.exec(html) ?? /value="([^"]+)"[^>]*name="token"/.exec(html);
  return m?.[1] ?? "";
}

/** The query string form B receives for the same argv (D6). */
export function qs(argv: readonly string[]): string {
  const params = new URLSearchParams();
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i]!.replace(/^--/, "");
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) params.append(name, "");
    else {
      params.append(name, next);
      i += 1;
    }
  }
  const s = params.toString();
  return s === "" ? "" : `?${s}`;
}

export interface Server {
  readonly port: number;
  readonly child: ChildProcess;
  readonly log: () => string;
  /** `POST /stop` with the token, then wait for the child; falls back to killing its tree. */
  stop(): Promise<{ exitCode: number | null; viaStop: boolean }>;
  get(target: string, options?: HttpOptions): Promise<Reply>;
  post(target: string, body: string, headers?: Record<string, string>): Promise<Reply>;
}

function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
  else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}
const exited = (child: ChildProcess, ms: number): Promise<boolean> =>
  new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve(true);
    const timer = setTimeout(() => resolve(false), ms);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });

/** Start `usage-dashboard serve --port 0 [args]`; resolves once LISTENING is printed, or rejects (child killed). */
export async function startServer(
  sb: Sandbox,
  args: readonly string[] = [],
  env: Record<string, string | undefined> = {},
): Promise<Server> {
  const child = spawn(
    process.execPath,
    [
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      path.join(REPO, "scripts", "usage-dashboard.ts"),
      "serve",
      "--port",
      "0",
      ...args,
    ],
    {
      env: { ...sb.env, ...env } as NodeJS.ProcessEnv,
      cwd: REPO,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let out = "";
  child.stdout?.on("data", (c: Buffer) => (out += c.toString()));
  child.stderr?.on("data", (c: Buffer) => (out += c.toString()));
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`serve never printed LISTENING: ${out.slice(0, 300)}`)),
      15000,
    );
    const poll = setInterval(() => {
      const m = /^LISTENING http:\/\/127\.0\.0\.1:(\d+)\//m.exec(out);
      // BOUND is a second write of the same callback; on Windows it can arrive in a later chunk.
      if (m && /^BOUND \S+$/m.test(out)) {
        clearTimeout(timer);
        clearInterval(poll);
        resolve(Number(m[1]));
      } else if (child.exitCode !== null) {
        clearTimeout(timer);
        clearInterval(poll);
        reject(new Error(`serve exited ${child.exitCode} before LISTENING: ${out.slice(0, 300)}`));
      }
    }, 50);
  }).catch((e: unknown) => {
    killTree(child);
    throw e;
  });
  const get = (target: string, options?: HttpOptions): Promise<Reply> =>
    httpReq("GET", port, target, options);
  const post = (
    target: string,
    body: string,
    headers: Record<string, string> = {},
  ): Promise<Reply> =>
    httpReq("POST", port, target, {
      body,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: `http://127.0.0.1:${port}`,
        ...headers,
      },
    });
  return {
    port,
    child,
    log: () => out,
    get,
    post,
    async stop() {
      if (child.exitCode === null && child.signalCode === null) {
        const token = formToken((await get("/")).body);
        if (token !== "") await post("/stop", `token=${token}`);
      }
      let viaStop = await exited(child, 5000);
      if (!viaStop) {
        killTree(child);
        await exited(child, 5000);
      }
      viaStop = viaStop && child.exitCode === 0;
      return { exitCode: child.exitCode, viaStop };
    },
  };
}

/** A foreign listener on 127.0.0.1:<ephemeral> (the 13.14 port-conflict holder), owned by the test process. */
export function holdPort(): Promise<{
  port: number;
  answers(): Promise<boolean>;
  close(): Promise<void>;
}> {
  const s = http.createServer((_q, r) => r.end("held-by-test-listener"));
  return new Promise((resolve) => {
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      resolve({
        port,
        answers: async () => (await httpReq("GET", port, "/")).body === "held-by-test-listener",
        close: () => new Promise((done) => s.close(() => done())),
      });
    });
  });
}

export interface FormsB {
  readonly B?: View;
  readonly Bv?: View;
  readonly Bhtml: string;
  readonly Bstatus: number | string;
  readonly errors: string[];
}
/** Form B of a selection: the page (embedded JSON) and `/view.json`. */
export async function formsB(server: Server, filters: readonly string[]): Promise<FormsB> {
  const query = qs(filters);
  const page = await server.get(`/${query}`);
  const view = await server.get(`/view.json${query}`);
  const errors: string[] = [];
  let B: View | undefined;
  let Bv: View | undefined;
  try {
    B = extractEmbedded(page.body);
  } catch (e) {
    errors.push(`B page ${page.status}: ${String(e)}`);
  }
  try {
    Bv = parseView(view.body);
  } catch {
    errors.push(`B view.json ${view.status}: ${view.body.slice(0, 200)}`);
  }
  return {
    ...(B ? { B } : {}),
    ...(Bv ? { Bv } : {}),
    Bhtml: page.body,
    Bstatus: page.status,
    errors,
  };
}

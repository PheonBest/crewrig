// chroma-wrapper-live.test.ts — the behavioural half of test-chroma-server.sh
// (spec 0263 G7, G10, G11): the real wrapper against a dead port, and a real
// `chromadb` HttpClient against a real `chroma run` started through the .sh shim.
// Skipped, with a printed reason and no sentinel, when the mempalace pipx venv or
// its `chroma` is absent (as in CI). POSIX-only. Isolation: scratch HOME and
// USERPROFILE (real path), scratch MEMPALACE_PALACE_PATH, a free loopback port,
// an empty CREWRIG_TEST_SERVICE_BIN_DIR; the daemon is stopped in `after`.
// Start idempotence, stop and status are pinned by chroma-lifecycle.test.ts.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { detectMempalacePython } from "../lib/mempalace-python.ts";
import { freePort, REPO } from "./lib/chroma-stand-in.ts";

const python = process.platform === "win32" ? undefined : detectMempalacePython();
const chroma = python === undefined ? undefined : path.join(path.dirname(python), "chroma");
const SKIP =
  process.platform === "win32"
    ? "POSIX-only: the .sh shims and the pipx bin/chroma layout"
    : python === undefined || chroma === undefined || !fs.existsSync(chroma)
      ? "mempalace pipx venv not installed"
      : false;

describe("chroma wrapper, live", { skip: SKIP }, () => {
  const home = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "chroma-wrapper-live-"));
  const services = path.join(home, "services");
  fs.mkdirSync(services);
  let env: NodeJS.ProcessEnv = {};
  let port = 0;

  const sh = (script: string, extra: NodeJS.ProcessEnv = env) =>
    spawnSync("bash", [path.join(REPO, "scripts", script)], {
      cwd: REPO,
      env: extra,
      encoding: "utf8",
      timeout: 60_000,
    });
  const py = (code: string) =>
    spawnSync(python ?? "python3", ["-c", code], { env, encoding: "utf8", timeout: 60_000 });

  before(async () => {
    port = await freePort();
    env = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      MEMPALACE_PYTHON: python,
      MEMPALACE_CHROMA_HOST: "127.0.0.1",
      MEMPALACE_CHROMA_PORT: String(port),
      MEMPALACE_PALACE_PATH: path.join(home, "palace"),
      CREWRIG_TEST_SERVICE_BIN_DIR: services,
    };
  });
  after(() => {
    if (SKIP === false) sh("stop-chroma-server.sh");
    fs.rmSync(home, { recursive: true, force: true });
  });

  test("the wrapper exits non-zero naming an unreachable daemon", async () => {
    const dead = await freePort();
    const r = spawnSync(
      python ?? "python3",
      [path.join(REPO, "scripts/lib/mempalace-http-wrapper.py")],
      {
        env: { ...env, MEMPALACE_CHROMA_PORT: String(dead) },
        encoding: "utf8",
        timeout: 60_000,
      },
    );
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /unreachable/i);
  });

  test("a real HttpClient is a ClientAPI and the pool ceilings bound it", () => {
    const start = sh("start-chroma-server.sh");
    assert.equal(start.status, 0, start.stdout + start.stderr);
    assert.ok(fs.existsSync(path.join(home, ".mempalace", "chroma-server.pid")), "no PID file");

    const api = py(`
import os, chromadb
from chromadb.api import ClientAPI
c = chromadb.HttpClient(host=os.environ['MEMPALACE_CHROMA_HOST'], port=int(os.environ['MEMPALACE_CHROMA_PORT']))
assert isinstance(c, ClientAPI), type(c)
c.heartbeat()
print('OK')
`);
    assert.equal(api.status, 0, api.stdout + api.stderr);
    assert.match(api.stdout, /OK/);

    // Each count is asserted individually: chromadb defaults the keepalive
    // seconds to 40.0, so a bare httpx.Limits equality would fail on a field the
    // spec never constrains.
    const pool = py(`
import os, chromadb
c = chromadb.HttpClient(host=os.environ['MEMPALACE_CHROMA_HOST'], port=int(os.environ['MEMPALACE_CHROMA_PORT']),
    settings=chromadb.Settings(chroma_http_max_connections=8, chroma_http_max_keepalive_connections=4))
l = c._server.http_limits
assert l.max_connections == 8, l.max_connections
assert l.max_keepalive_connections == 4, l.max_keepalive_connections
print('OK')
`);
    assert.equal(pool.status, 0, pool.stdout + pool.stderr);
    assert.match(pool.stdout, /OK/);
  });
});

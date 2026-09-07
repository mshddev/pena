import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { closedPort, makeTempDirectory, runCli } from "../test/helpers.js";

let directory: string;
let env: NodeJS.ProcessEnv;
let recordPath: string;
/** Pids of servers the tests started, so a failing assertion still leaves nothing behind. */
const startedPids = new Set<number>();
const children = new Set<ChildProcess>();
const servers = new Set<Server>();

beforeEach(() => {
  directory = makeTempDirectory("pena-cli-server-");
  recordPath = join(directory, "state", "server.json");
  env = {
    ...process.env,
    PENA_STATE_DIR: join(directory, "state"),
    PENA_DB_PATH: join(directory, "pena.sqlite"),
    PENA_ASSETS_DIR: join(directory, "assets"),
  };
});

afterEach(async () => {
  for (const pid of [...startedPids, readRecord()?.pid]) {
    if (pid !== undefined) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
  }

  startedPids.clear();

  for (const child of children) {
    child.kill("SIGKILL");
  }

  children.clear();

  for (const server of servers) {
    await new Promise((resolve) => server.close(resolve));
  }

  servers.clear();
  rmSync(directory, { recursive: true, force: true });
});

function readRecord(): { pid: number; url: string } | undefined {
  try {
    return JSON.parse(readFileSync(recordPath, "utf8"));
  } catch {
    return undefined;
  }
}

function writeRecord(record: { pid: number; url: string }): void {
  mkdirSync(join(directory, "state"), { recursive: true });
  writeFileSync(recordPath, `${JSON.stringify(record)}\n`);
}

async function startServer(port: number): Promise<string> {
  const baseUrl = `http://127.0.0.1:${port}`;
  const started = await runCli(["--json", "server", "start", "--port", String(port)], {
    baseUrl: "http://127.0.0.1:1",
    env,
  });
  expect(started.stderr).toBe("");
  expect(started.code).toBe(0);
  startedPids.add(started.json().pid);
  return baseUrl;
}

async function isHealthy(baseUrl: string): Promise<boolean> {
  try {
    return (await fetch(`${baseUrl}/api/health`)).status === 200;
  } catch {
    return false;
  }
}

/** A process that is alive but is not a Pena server. */
function spawnSleep(): ChildProcess {
  const child = spawn("sleep", ["1000"], { stdio: "ignore" });
  children.add(child);
  return child;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** A plain HTTP server that answers 200 HTML to everything, like a SPA dev server. */
async function startForeignServer(): Promise<string> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<html></html>");
  });
  servers.add(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Expected a TCP port.");
  }

  return `http://127.0.0.1:${address.port}`;
}

describe("pena server", () => {
  it("starts, reports, and stops a detached server", async () => {
    const port = await closedPort();
    const baseUrl = `http://127.0.0.1:${port}`;

    const before = await runCli(["--json", "server", "status"], { baseUrl, env });
    expect(before.code).toBe(0);
    expect(before.json()).toEqual({ running: false, url: baseUrl, pid: null });

    const stopIdle = await runCli(["--json", "server", "stop"], { baseUrl, env });
    expect(stopIdle.code).toBe(0);
    expect(stopIdle.json()).toEqual({ stopped: false, pid: null });

    const started = await runCli(["server", "start", "--port", String(port)], {
      baseUrl: "http://127.0.0.1:1",
      env,
    });
    expect(started.stderr).toBe("");
    expect(started.code).toBe(0);
    expect(started.stdout).toBe(`Pena is running at ${baseUrl}\n`);
    expect(readRecord()).toEqual({ pid: expect.any(Number), url: baseUrl });
    expect(existsSync(join(directory, "state", "server.log"))).toBe(true);
    startedPids.add(readRecord()!.pid);

    const status = await runCli(["--json", "server", "status"], { baseUrl, env });
    expect(status.json()).toEqual({ running: true, url: baseUrl, pid: expect.any(Number) });

    const again = await runCli(["--json", "server", "start"], { baseUrl, env });
    expect(again.code).toBe(0);
    expect(again.json()).toEqual({ running: true, url: baseUrl, pid: status.json().pid });

    const health = await fetch(`${baseUrl}/api/health`);
    expect(health.status).toBe(200);

    const stopped = await runCli(["--json", "server", "stop"], { baseUrl, env });
    expect(stopped.code).toBe(0);
    expect(stopped.json()).toEqual({ stopped: true, pid: status.json().pid });
    expect(existsSync(recordPath)).toBe(false);

    const after = await runCli(["--json", "server", "status"], { baseUrl, env });
    expect(after.json()).toEqual({ running: false, url: baseUrl, pid: null });
  }, 30_000);

  it("refuses to start a second server over one it already started", async () => {
    const first = await startServer(await closedPort());
    const otherPort = await closedPort();
    const otherUrl = `http://127.0.0.1:${otherPort}`;
    const record = readRecord();

    const second = await runCli(["--json", "server", "start", "--port", String(otherPort)], {
      baseUrl: first,
      env,
    });
    expect(second.code).toBe(1);
    expect(JSON.parse(second.stderr).error).toContain(
      `already started by this CLI as pid ${record!.pid} at ${first}`,
    );
    expect(readRecord()).toEqual(record);
    expect(await isHealthy(first)).toBe(true);
    expect(await isHealthy(otherUrl)).toBe(false);

    // status and stop only act on the record for the requested URL.
    const otherStatus = await runCli(["--json", "server", "status"], { baseUrl: otherUrl, env });
    expect(otherStatus.json()).toEqual({ running: false, url: otherUrl, pid: null });

    const otherStop = await runCli(["server", "stop"], { baseUrl: otherUrl, env });
    expect(otherStop.code).toBe(0);
    expect(otherStop.stdout).toContain(`Pass \`--url ${first}\` to stop it.`);
    expect(readRecord()).toEqual(record);
    expect(await isHealthy(first)).toBe(true);

    const stopped = await runCli(["--json", "server", "stop"], { baseUrl: first, env });
    expect(stopped.json()).toEqual({ stopped: true, pid: record!.pid });
    expect(await isHealthy(first)).toBe(false);
  }, 30_000);

  it("does not signal a recorded pid that is not a Pena server", async () => {
    const baseUrl = `http://127.0.0.1:${await closedPort()}`;
    const bystander = spawnSleep();
    writeRecord({ pid: bystander.pid!, url: baseUrl });

    const status = await runCli(["--json", "server", "status"], { baseUrl, env });
    expect(status.json()).toEqual({ running: false, url: baseUrl, pid: null });

    const stopped = await runCli(["--json", "server", "stop"], { baseUrl, env });
    expect(stopped.code).toBe(0);
    expect(stopped.json()).toEqual({ stopped: false, pid: null });
    expect(existsSync(recordPath)).toBe(false);
    expect(isAlive(bystander.pid!)).toBe(true);
  });

  it("treats a pid it may not signal as a stale record", async () => {
    const baseUrl = `http://127.0.0.1:${await closedPort()}`;
    writeRecord({ pid: 1, url: baseUrl });

    const stopped = await runCli(["--json", "server", "stop"], { baseUrl, env });
    expect(stopped.code).toBe(0);
    expect(stopped.stderr).toBe("");
    expect(stopped.json()).toEqual({ stopped: false, pid: null });
    expect(existsSync(recordPath)).toBe(false);
  });

  it("does not report a dead recorded pid as the running server", async () => {
    const baseUrl = await startServer(await closedPort());
    writeRecord({ pid: 999_999, url: baseUrl });

    const again = await runCli(["--json", "server", "start"], { baseUrl, env });
    expect(again.code).toBe(0);
    expect(again.json()).toEqual({ running: true, url: baseUrl, pid: null });

    const status = await runCli(["server", "status"], { baseUrl, env });
    expect(status.stdout).toBe(
      `Pena is running at ${baseUrl}, but it was not started by this CLI.\n`,
    );
  }, 30_000);

  it("does not mistake a foreign HTTP server for Pena", async () => {
    const foreign = await startForeignServer();

    const status = await runCli(["--json", "server", "status"], { baseUrl: foreign, env });
    expect(status.code).toBe(0);
    expect(status.json()).toEqual({ running: false, url: foreign, pid: null });
  });

  it("rejects a bad --port with exit 2", async () => {
    const result = await runCli(["server", "start", "--port", "http"], { env });
    expect(result.code).toBe(2);
  });

  it("checks PENA_WEB_DIR instead of the in-tree web build when it is set", async () => {
    const port = await closedPort();
    const url = `http://127.0.0.1:${port}`;
    const missing = join(directory, "no-web-build");
    const result = await runCli(["server", "start", "--url", url], {
      env: { ...env, PENA_WEB_DIR: missing },
    });

    expect(result.code).toBe(2);
    expect(result.stderr).toContain(join(missing, "index.html"));
    expect(result.stderr).toContain("PENA_WEB_DIR");
    expect(readRecord()).toBeUndefined();
  });
});

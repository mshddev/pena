import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

import { PenaClient } from "../client.js";
import { CliError, EXIT_FAILURE, usageError } from "../errors.js";
import {
  serverEntryPath,
  stateDirectory,
  webIndexPath,
} from "../paths.js";
import {
  booleanOption,
  stringOption,
  type CommandContext,
  type CommandHandler,
} from "./context.js";

const START_TIMEOUT_MS = 10_000;
const STOP_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 200;
const LOG_TAIL_LINES = 20;

/** What `server start` records about the server it spawned. */
interface ServerRecord {
  pid: number;
  url: string;
}

function recordPath(stateDir: string): string {
  return join(stateDir, "server.json");
}

function logPath(stateDir: string): string {
  return join(stateDir, "server.log");
}

function readRecord(stateDir: string): ServerRecord | null {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(recordPath(stateDir), "utf8"),
    );

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "pid" in parsed &&
      "url" in parsed &&
      typeof parsed.pid === "number" &&
      Number.isSafeInteger(parsed.pid) &&
      parsed.pid > 0 &&
      typeof parsed.url === "string"
    ) {
      return { pid: parsed.pid, url: parsed.url };
    }

    return null;
  } catch {
    return null;
  }
}

function writeRecord(stateDir: string, record: ServerRecord): void {
  writeFileSync(recordPath(stateDir), `${JSON.stringify(record)}\n`);
}

function removeRecord(stateDir: string): void {
  rmSync(recordPath(stateDir), { force: true });
}

/** Send a signal; a pid that has already exited (ESRCH) is not an error. */
function signalProcess(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      throw error;
    }
  }
}

/** Whether a process with this pid exists; EPERM counts as existing. */
function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Whether `record.pid` is a live Pena server this user may signal. A record
 * outlives its server (reboot, crash, `kill -9`) and the pid can be reused
 * by an unrelated process, so the process must be signalable and its
 * command line must name the server entry this CLI spawns. When `ps` is
 * unavailable, fall back to the health check at the recorded URL.
 */
async function isOurServer(record: ServerRecord): Promise<boolean> {
  try {
    process.kill(record.pid, 0);
  } catch {
    // ESRCH: gone. EPERM: someone else's process, so not ours to signal.
    return false;
  }

  const ps = spawnSync("ps", ["-o", "command=", "-p", String(record.pid)], {
    encoding: "utf8",
  });

  if (ps.error) {
    return new PenaClient(record.url).isHealthy();
  }

  return ps.status === 0 && ps.stdout.includes(serverEntryPath);
}

/** The pid recorded for `url`, when that server is still alive and ours. */
async function ownedPid(stateDir: string, url: string): Promise<number | null> {
  const record = readRecord(stateDir);

  return record !== null && record.url === url && (await isOurServer(record))
    ? record.pid
    : null;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function logTail(path: string): string {
  try {
    const lines = readFileSync(path, "utf8").trimEnd().split("\n");
    return lines.slice(-LOG_TAIL_LINES).join("\n");
  } catch {
    return "(no log output)";
  }
}

function parsePort(value: string): number {
  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65_535 || String(port) !== value) {
    throw usageError("--port must be an integer from 1 to 65535.");
  }

  return port;
}

function withPort(baseUrl: string, port: number): string {
  const url = new URL(baseUrl);
  url.port = String(port);
  return url.toString().replace(/\/+$/, "");
}

function urlPort(baseUrl: string): number {
  const url = new URL(baseUrl);
  return url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
}

async function runForeground(
  context: CommandContext,
  env: NodeJS.ProcessEnv,
): Promise<undefined> {
  const { io } = context;
  const child = spawn(process.execPath, [serverEntryPath], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk: Buffer) => io.stdout.write(String(chunk)));
  child.stderr.on("data", (chunk: Buffer) => io.stderr.write(String(chunk)));
  const stop = () => child.kill("SIGTERM");
  io.signal.addEventListener("abort", stop, { once: true });

  try {
    const [code, signal] = (await once(child, "exit")) as [
      number | null,
      NodeJS.Signals | null,
    ];

    // The only acceptable exit is a clean one, or the SIGTERM this CLI sent
    // when the user interrupted it. A signal death (OOM kill, a native crash)
    // is a failure even though it has no exit code.
    if (io.signal.aborted) {
      return undefined;
    }

    if (code !== 0) {
      throw new CliError(
        code === null
          ? `Pena was terminated by ${signal ?? "a signal"}.`
          : `Pena exited with code ${code}.`,
        EXIT_FAILURE,
      );
    }
  } finally {
    io.signal.removeEventListener("abort", stop);
  }

  return undefined;
}

export const serverStart: CommandHandler = async (context) => {
  const major = Number(process.versions.node.split(".")[0]);

  if (major < 24) {
    throw usageError(
      `Pena requires Node.js 24 or newer, but this is Node.js ${process.versions.node}. Switch to Node.js 24 (for example \`nvm use 24\`) and retry.`,
    );
  }

  const portOption = stringOption(context, "port");
  const port =
    portOption === undefined ? urlPort(context.baseUrl) : parsePort(portOption);
  const url = withPort(context.baseUrl, port);
  const client = new PenaClient(url);
  const stateDir = stateDirectory(context.io.env);

  if (await client.isHealthy()) {
    return {
      data: { running: true, url, pid: await ownedPid(stateDir, url) },
      text: `Pena is already running at ${url}`,
    };
  }

  // The server honours PENA_WEB_DIR, so an out-of-tree web build must
  // satisfy the precondition just like the in-tree one.
  const webDirectory = context.io.env.PENA_WEB_DIR;
  const requiredWebIndex = webDirectory
    ? join(resolve(webDirectory), "index.html")
    : webIndexPath;

  for (const required of [serverEntryPath, requiredWebIndex]) {
    if (!existsSync(required)) {
      throw usageError(
        required === requiredWebIndex && webDirectory
          ? `Missing ${required}. PENA_WEB_DIR must point at a built web app.`
          : `Missing ${required}. Run \`pnpm build\` in the Pena repository first.`,
      );
    }
  }

  const env: NodeJS.ProcessEnv = { ...context.io.env, PORT: String(port) };

  if (booleanOption(context, "foreground")) {
    return runForeground(context, env);
  }

  // Never spawn a second server over a live one this CLI already started:
  // the record can hold only one, and overwriting it would orphan the first.
  const existing = readRecord(stateDir);

  if (existing !== null) {
    if (await isOurServer(existing)) {
      throw new CliError(
        `Pena was already started by this CLI as pid ${existing.pid} at ${existing.url}, but it does not answer at ${url}. Stop it with \`pena --url ${existing.url} server stop\` before starting another.`,
        EXIT_FAILURE,
      );
    }

    removeRecord(stateDir);
  }

  mkdirSync(stateDir, { recursive: true });
  const log = logPath(stateDir);
  const logFd = openSync(log, "a");
  let child: ReturnType<typeof spawn>;

  try {
    child = spawn(process.execPath, [serverEntryPath], {
      detached: true,
      env,
      stdio: ["ignore", logFd, logFd],
    });
  } finally {
    closeSync(logFd);
  }

  let exitCode: number | null | undefined;
  child.once("exit", (code) => {
    exitCode = code;
  });
  child.unref();

  const pid = child.pid;

  if (pid === undefined) {
    throw new CliError("Could not start the Pena server.", EXIT_FAILURE);
  }

  writeRecord(stateDir, { pid, url });
  const deadline = Date.now() + START_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (await client.isHealthy()) {
      return {
        data: { running: true, url, pid },
        text: `Pena is running at ${url}`,
      };
    }

    if (exitCode !== undefined) {
      break;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  // Only drop the record when it still names this child; a concurrent start
  // may have replaced it with a server that is running fine.
  if (exitCode !== undefined && readRecord(stateDir)?.pid === pid) {
    removeRecord(stateDir);
  }

  throw new CliError(
    `${
      exitCode === undefined
        ? `Pena did not answer at ${url} within ${START_TIMEOUT_MS / 1000} s`
        : `Pena exited with code ${exitCode ?? "null"} before it answered`
    }. Log tail from ${log}:\n${logTail(log)}`,
    EXIT_FAILURE,
  );
};

export const serverStop: CommandHandler = async (context) => {
  const stateDir = stateDirectory(context.io.env);
  const url = context.baseUrl;
  const record = readRecord(stateDir);
  const notRunning = (text: string) => ({
    data: { stopped: false, pid: null },
    text,
  });

  if (record === null) {
    return notRunning(
      "Pena is not running (no server was started by this CLI).",
    );
  }

  if (!(await isOurServer(record))) {
    // The recorded server is gone, or its pid now belongs to something else.
    removeRecord(stateDir);

    return notRunning(
      "Pena is not running (no server was started by this CLI).",
    );
  }

  if (record.url !== url) {
    return notRunning(
      `Pena is not running at ${url}; this CLI started pid ${record.pid} at ${record.url}. Pass \`--url ${record.url}\` to stop it.`,
    );
  }

  const { pid } = record;
  // The server may exit on its own between the ownership check and each
  // signal; a vanished pid is a successful stop, not an error.
  signalProcess(pid, "SIGTERM");
  const deadline = Date.now() + STOP_TIMEOUT_MS;

  while (Date.now() < deadline && processExists(pid)) {
    await sleep(100);
  }

  if (processExists(pid)) {
    signalProcess(pid, "SIGKILL");
    const killDeadline = Date.now() + STOP_TIMEOUT_MS;

    while (Date.now() < killDeadline && processExists(pid)) {
      await sleep(50);
    }

    if (processExists(pid)) {
      throw new CliError(
        `Pena (pid ${pid}) did not exit after SIGKILL. Inspect it with \`ps -p ${pid}\`.`,
        EXIT_FAILURE,
      );
    }
  }

  if (readRecord(stateDir)?.pid === pid) {
    removeRecord(stateDir);
  }

  return {
    data: { stopped: true, pid },
    text: `Stopped Pena (pid ${pid}).`,
  };
};

export const serverStatus: CommandHandler = async (context) => {
  const stateDir = stateDirectory(context.io.env);
  const url = context.baseUrl;
  const running = await context.client.isHealthy();
  const pid = await ownedPid(stateDir, url);

  return {
    data: { running, url, pid },
    text: running
      ? pid === null
        ? `Pena is running at ${url}, but it was not started by this CLI.`
        : `Pena is running at ${url} (pid ${pid}).`
      : `Pena is not running at ${url}.`,
  };
};

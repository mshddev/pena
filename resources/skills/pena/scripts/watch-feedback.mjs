#!/usr/bin/env node

const DEFAULT_BASE_URL = "http://127.0.0.1:8788";
const LONG_POLL_TIMEOUT_MS = 25_000;
const REQUEST_TIMEOUT_MS = 35_000;
const MAX_RETRY_DELAY_MS = 5_000;

class TerminalWatchError extends Error {}

const options = parseOptions(process.argv.slice(2));
const shutdown = new AbortController();
let retryDelayMs = 250;
let after = options.after;

process.once("SIGINT", () => shutdown.abort());
process.once("SIGTERM", () => shutdown.abort());

while (!shutdown.signal.aborted) {
  const url = new URL(
    `/api/workspaces/${encodeURIComponent(options.workspace)}` +
      `/documents/${encodeURIComponent(options.document)}/feedback/wait`,
    options.baseUrl,
  );
  url.searchParams.set("after", String(after));
  url.searchParams.set("timeout", String(LONG_POLL_TIMEOUT_MS));

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: AbortSignal.any([
        shutdown.signal,
        AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ]),
    });

    if (response.status === 204) {
      retryDelayMs = 250;
      continue;
    }

    if (!response.ok) {
      const message = await response.text();

      if ([400, 404, 409].includes(response.status)) {
        throw new TerminalWatchError(
          `Pena feedback watch stopped with HTTP ${response.status}: ${message}`,
        );
      }

      throw new Error(
        `Pena feedback wait returned HTTP ${response.status}: ${message}`,
      );
    }

    const event = await response.json();

    if (
      !Number.isSafeInteger(event.latestBatchId) ||
      event.latestBatchId < 1 ||
      event.latestBatchId <= after ||
      !Array.isArray(event.batches) ||
      event.batches.length === 0
    ) {
      throw new Error("Pena returned an invalid feedback wait response.");
    }

    after = event.latestBatchId;
    retryDelayMs = 250;
    process.stdout.write(
      `${JSON.stringify({
        type: "pena_feedback_submitted",
        workspaceSlug: event.workspaceSlug,
        documentSlug: event.documentSlug,
        documentVersion: event.documentVersion,
        latestBatchId: event.latestBatchId,
        batchIds: event.batches.map((batch) => batch.id),
      })}\n`,
    );
  } catch (error) {
    if (shutdown.signal.aborted) {
      break;
    }

    if (error instanceof TerminalWatchError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
      break;
    }

    process.stderr.write(
      `Pena feedback watch reconnecting: ${errorMessage(error)}\n`,
    );
    await delay(retryDelayMs, shutdown.signal);
    retryDelayMs = Math.min(retryDelayMs * 2, MAX_RETRY_DELAY_MS);
  }
}

function parseOptions(args) {
  const values = new Map();

  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];

    if (!name?.startsWith("--") || value === undefined) {
      usage();
    }

    values.set(name.slice(2), value);
  }

  const workspace = values.get("workspace");
  const document = values.get("document");
  const baseUrl = values.get("base-url") ?? DEFAULT_BASE_URL;
  const afterValue = values.get("after") ?? "0";
  const after = Number(afterValue);

  if (!workspace || !document) {
    usage();
  }

  if (!Number.isSafeInteger(after) || after < 0 || String(after) !== afterValue) {
    fail('The "--after" cursor must be a non-negative integer.');
  }

  let parsedBaseUrl;

  try {
    parsedBaseUrl = new URL(baseUrl);
  } catch {
    fail('The "--base-url" value must be a valid URL.');
  }

  if (!["http:", "https:"].includes(parsedBaseUrl.protocol)) {
    fail('The "--base-url" value must use HTTP or HTTPS.');
  }

  return {
    workspace,
    document,
    after,
    baseUrl: parsedBaseUrl,
  };
}

function usage() {
  fail(
    "Usage: watch-feedback.mjs --workspace <slug> --document <slug> " +
      "[--after <batch-id>] [--base-url <url>]",
  );
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function delay(milliseconds, signal) {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
  });
}

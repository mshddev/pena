import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createDocument,
  startApp,
  submitFeedback,
  type TestApp,
} from "../test/helpers.js";

const cliPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const children = new Set<ChildProcessWithoutNullStreams>();
let test: TestApp;

beforeEach(async () => {
  test = await startApp();
});

afterEach(async () => {
  for (const child of children) {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
  }

  children.clear();
  await test.close();
});

describe("pena feedback watch", () => {
  it("prints one Monitor event line per committed feedback batch", async () => {
    await createDocument(test, "initial-spec");
    const child = startWatcher(test.baseUrl, "initial-spec");
    const output = readLines(child);

    // Give the watcher a moment to open its long poll, then wake it up.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const first = await submitFeedback(test, "initial-spec", "First.");
    const line = await output.next();
    const second = await submitFeedback(test, "initial-spec", "Second.");
    const secondLine = await output.next();

    expect(JSON.parse(line)).toEqual({
      type: "pena_feedback_submitted",
      documentSlug: "initial-spec",
      documentVersion: 1,
      latestBatchId: first.id,
      batchIds: [first.id],
    });
    expect(JSON.parse(secondLine)).toEqual({
      type: "pena_feedback_submitted",
      documentSlug: "initial-spec",
      documentVersion: 1,
      latestBatchId: second.id,
      batchIds: [second.id],
    });
    expect(Object.keys(JSON.parse(line))).toEqual([
      "type",
      "documentSlug",
      "documentVersion",
      "latestBatchId",
      "batchIds",
    ]);
  });

  it("stops with exit code 1 and a useful error for a missing document", async () => {
    const child = startWatcher(test.baseUrl, "missing-doc");
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const [exitCode] = await once(child, "exit");

    expect(exitCode).toBe(1);
    expect(stderr).toContain("HTTP 404");
    expect(stderr).toContain("No document has been published");
  });

  it("exits cleanly on SIGTERM", async () => {
    await createDocument(test, "initial-spec");
    const child = startWatcher(test.baseUrl, "initial-spec");
    await new Promise((resolve) => setTimeout(resolve, 300));

    child.kill("SIGTERM");
    const [exitCode] = await once(child, "exit");

    expect(exitCode).toBe(0);
  });
});

function startWatcher(
  baseUrl: string,
  slug: string,
): ChildProcessWithoutNullStreams {
  const child = spawn(process.execPath, [
    cliPath,
    "feedback",
    "watch",
    "--url",
    baseUrl,
    slug,
  ]);
  children.add(child);
  return child;
}

function readLines(child: ChildProcessWithoutNullStreams): {
  next(): Promise<string>;
} {
  child.stdout.setEncoding("utf8");
  let buffered = "";
  const pending: string[] = [];
  const waiters: Array<(line: string) => void> = [];

  child.stdout.on("data", (chunk: string) => {
    buffered += chunk;
    let newline = buffered.indexOf("\n");

    while (newline !== -1) {
      const line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      const waiter = waiters.shift();

      if (waiter) {
        waiter(line);
      } else {
        pending.push(line);
      }

      newline = buffered.indexOf("\n");
    }
  });

  return {
    next() {
      const line = pending.shift();

      if (line !== undefined) {
        return Promise.resolve(line);
      }

      return new Promise((resolve) => waiters.push(resolve));
    },
  };
}

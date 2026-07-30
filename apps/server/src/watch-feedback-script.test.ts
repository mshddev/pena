import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const watcherPath = fileURLToPath(
  new URL(
    "../../../resources/skills/pena/scripts/watch-feedback.mjs",
    import.meta.url,
  ),
);
const children = new Set<ChildProcessWithoutNullStreams>();
const servers = new Set<Server>();

afterEach(async () => {
  for (const child of children) {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
  }

  await Promise.all(
    [...servers].map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
  children.clear();
  servers.clear();
});

describe("Pena feedback watcher", () => {
  it("prints one Monitor event for a successful long-poll response", async () => {
    let requests = 0;
    const baseUrl = await startServer((_request, response) => {
      requests += 1;

      if (requests > 1) {
        response.writeHead(204).end();
        return;
      }

      response
        .writeHead(200, { "content-type": "application/json" })
        .end(
          JSON.stringify({
            workspaceSlug: "default",
            documentSlug: "initial-spec",
            documentVersion: 3,
            latestBatchId: 8,
            batches: [
              { id: 7, submittedAt: "2026-07-30T00:00:00.000Z" },
              { id: 8, submittedAt: "2026-07-30T00:00:01.000Z" },
            ],
          }),
        );
    });
    const child = startWatcher(baseUrl);

    const line = await readLine(child);

    expect(JSON.parse(line)).toEqual({
      type: "pena_feedback_submitted",
      workspaceSlug: "default",
      documentSlug: "initial-spec",
      documentVersion: 3,
      latestBatchId: 8,
      batchIds: [7, 8],
    });
  });

  it("exits cleanly with a useful error for a missing document", async () => {
    const baseUrl = await startServer((_request, response) => {
      response
        .writeHead(404, { "content-type": "application/json" })
        .end('{"error":"Document not found."}');
    });
    const child = startWatcher(baseUrl);
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const [exitCode] = await once(child, "exit");

    expect(exitCode).toBe(1);
    expect(stderr).toContain("HTTP 404");
    expect(stderr).toContain("Document not found");
  });
});

async function startServer(
  handler: Parameters<typeof createServer>[0],
): Promise<string> {
  const server = createServer(handler);
  servers.add(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Expected the test server to use a TCP port.");
  }

  return `http://127.0.0.1:${address.port}`;
}

function startWatcher(baseUrl: string): ChildProcessWithoutNullStreams {
  const child = spawn(process.execPath, [
    watcherPath,
    "--workspace",
    "default",
    "--document",
    "initial-spec",
    "--base-url",
    baseUrl,
  ]);
  children.add(child);
  return child;
}

async function readLine(
  child: ChildProcessWithoutNullStreams,
): Promise<string> {
  child.stdout.setEncoding("utf8");
  let output = "";

  for await (const chunk of child.stdout) {
    output += chunk;
    const newline = output.indexOf("\n");

    if (newline !== -1) {
      return output.slice(0, newline);
    }
  }

  throw new Error("The feedback watcher exited without printing an event.");
}

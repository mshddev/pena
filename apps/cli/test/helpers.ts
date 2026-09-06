import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The server package ships no type declarations; vitest only transpiles.
// @ts-ignore
import { buildApp } from "@pena/server/dist/app.js";
// @ts-ignore
import { FileAssetStore } from "@pena/server/dist/storage/file-asset-store.js";
// @ts-ignore
import { SqlitePenaStore } from "@pena/server/dist/storage/sqlite-pena-store.js";

import { run } from "../src/run.js";

/** A 1x1 transparent PNG. */
export const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

export interface InjectResponse {
  statusCode: number;
  headers: Record<string, unknown>;
  json(): any;
  body: string;
}

export interface TestApp {
  app: {
    inject(options: {
      method: string;
      url: string;
      headers?: Record<string, string>;
      payload?: unknown;
    }): Promise<InjectResponse>;
    close(): Promise<void>;
  };
  baseUrl: string;
  port: number;
  close(): Promise<void>;
}

export async function startApp(): Promise<TestApp> {
  const assetsDirectory = mkdtempSync(join(tmpdir(), "pena-cli-assets-"));
  const app = buildApp(
    new SqlitePenaStore(":memory:"),
    new FileAssetStore(assetsDirectory),
  );
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();

  if (!address || typeof address === "string") {
    throw new Error("Expected the test app to listen on a TCP port.");
  }

  return {
    app,
    port: address.port,
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      await app.close();
      rmSync(assetsDirectory, { recursive: true, force: true });
    },
  };
}

export interface CliOutcome {
  code: number;
  stdout: string;
  stderr: string;
  json(): any;
}

export async function runCli(
  args: string[],
  options: {
    baseUrl?: string;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
  } = {},
): Promise<CliOutcome> {
  let stdout = "";
  let stderr = "";
  const code = await run(
    options.baseUrl ? ["--url", options.baseUrl, ...args] : args,
    {
      stdout: { write: (chunk: string) => (stdout += chunk) },
      stderr: { write: (chunk: string) => (stderr += chunk) },
      env: options.env ?? {},
      cwd: options.cwd ?? process.cwd(),
      ...(options.signal ? { signal: options.signal } : {}),
    },
  );

  return {
    code,
    stdout,
    stderr,
    json() {
      return JSON.parse(stdout);
    },
  };
}

export async function createDocument(
  test: TestApp,
  slug: string,
  content = "Current draft",
  title = "Initial Specification",
): Promise<{ etag: string }> {
  const response = await test.app.inject({
    method: "PUT",
    url: `/api/docs/${slug}`,
    headers: { "content-type": "application/json", "if-none-match": "*" },
    payload: { title, content },
  });

  if (response.statusCode !== 201) {
    throw new Error(`Could not create ${slug}: ${response.body}`);
  }

  return { etag: String(response.headers.etag) };
}

export async function documentEtag(test: TestApp, slug: string): Promise<string> {
  const response = await test.app.inject({
    method: "GET",
    url: `/api/docs/${slug}`,
  });
  return String(response.headers.etag);
}

export async function submitFeedback(
  test: TestApp,
  slug: string,
  comment = "Change this.",
): Promise<{ id: number }> {
  const response = await test.app.inject({
    method: "POST",
    url: `/api/docs/${slug}/feedback`,
    headers: {
      "content-type": "application/json",
      "if-match": await documentEtag(test, slug),
    },
    payload: {
      comments: [
        {
          selectedText: "Current",
          comment,
          contextBefore: "",
          contextAfter: " draft",
        },
      ],
    },
  });

  if (response.statusCode !== 201) {
    throw new Error(`Could not submit feedback: ${response.body}`);
  }

  return response.json();
}

export function makeTempDirectory(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** A TCP port nothing listens on. */
export async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Expected a TCP port.");
  }

  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

  return address.port;
}

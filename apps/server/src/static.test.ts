import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";
import { FileAssetStore } from "./storage/file-asset-store.js";
import { SqlitePenaStore } from "./storage/sqlite-pena-store.js";

const INDEX_HTML = "<!doctype html><title>Pena shell</title>";
const APP_JS = "console.log('pena');";
const NOT_FOUND = { error: "Not found." };

const apps = new Set<ReturnType<typeof buildApp>>();
const temporaryDirectories = new Set<string>();

function createTemporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.add(directory);
  return directory;
}

function createWebDirectory(): string {
  const directory = createTemporaryDirectory("pena-web-");
  mkdirSync(join(directory, "assets"));
  writeFileSync(join(directory, "index.html"), INDEX_HTML);
  writeFileSync(join(directory, "assets", "app.js"), APP_JS);
  return directory;
}

function createApp(webDirectory?: string): ReturnType<typeof buildApp> {
  const app = buildApp(
    new SqlitePenaStore(":memory:"),
    new FileAssetStore(createTemporaryDirectory("pena-assets-")),
    webDirectory === undefined ? undefined : { webDirectory },
  );
  apps.add(app);
  return app;
}

afterEach(async () => {
  await Promise.all([...apps].map((app) => app.close()));
  apps.clear();

  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.clear();
});

describe("web app serving", () => {
  it("serves the SPA shell for client-side routes", async () => {
    const app = createApp(createWebDirectory());

    for (const url of [
      "/",
      "/collections",
      "/collections/specs",
      "/archive",
      "/archive?collection=specs",
      "/docs/some-slug",
    ]) {
      const response = await app.inject({ method: "GET", url });

      expect(response.statusCode, url).toBe(200);
      expect(response.headers["content-type"], url).toMatch(/^text\/html/);
      expect(response.body, url).toBe(INDEX_HTML);
    }
  });

  it("serves the SPA shell for HEAD requests to client-side routes", async () => {
    const app = createApp(createWebDirectory());

    const response = await app.inject({ method: "HEAD", url: "/archive" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toMatch(/^text\/html/);
  });

  it("serves built files from the web directory", async () => {
    const app = createApp(createWebDirectory());

    const asset = await app.inject({ method: "GET", url: "/assets/app.js" });
    const index = await app.inject({ method: "GET", url: "/index.html" });

    expect(asset.statusCode).toBe(200);
    expect(asset.headers["content-type"]).toMatch(/javascript/);
    expect(asset.body).toBe(APP_JS);
    expect(index.statusCode).toBe(200);
    expect(index.body).toBe(INDEX_HTML);
  });

  it("serves files added after startup, so a rebuild needs no restart", async () => {
    const webDirectory = createWebDirectory();
    const app = createApp(webDirectory);

    expect(
      (await app.inject({ method: "GET", url: "/assets/new.js" })).statusCode,
    ).toBe(404);

    writeFileSync(join(webDirectory, "assets", "new.js"), "console.log(1);");
    rmSync(join(webDirectory, "assets", "app.js"));
    const added = await app.inject({ method: "GET", url: "/assets/new.js" });
    const removed = await app.inject({ method: "GET", url: "/assets/app.js" });

    expect(added.statusCode).toBe(200);
    expect(added.body).toBe("console.log(1);");
    expect(removed.statusCode).toBe(404);
    expect(removed.json()).toEqual(NOT_FOUND);
  });

  it("returns a JSON 404 for missing files instead of the SPA shell", async () => {
    const app = createApp(createWebDirectory());

    const response = await app.inject({
      method: "GET",
      url: "/assets/missing.js",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual(NOT_FOUND);
  });

  it("returns a JSON 404 for unknown API routes regardless of method", async () => {
    const app = createApp(createWebDirectory());

    for (const method of ["GET", "HEAD", "POST", "DELETE"] as const) {
      const response = await app.inject({ method, url: "/api/nope" });

      expect(response.statusCode, method).toBe(404);
      expect(response.headers["content-type"], method).toMatch(
        /^application\/json/,
      );
      if (method !== "HEAD") {
        expect(response.json(), method).toEqual(NOT_FOUND);
      }
    }
  });

  it("returns a JSON 404 for non-GET requests to client-side routes", async () => {
    const app = createApp(createWebDirectory());

    const response = await app.inject({ method: "POST", url: "/docs/x" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual(NOT_FOUND);
  });

  it("keeps the API reachable alongside the web app", async () => {
    const app = createApp(createWebDirectory());

    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("does not serve client-side routes without a web directory", async () => {
    for (const app of [createApp(), createApp(undefined)]) {
      const response = await app.inject({ method: "GET", url: "/docs/x" });

      expect(response.statusCode).toBe(404);
      expect(response.body).not.toBe(INDEX_HTML);
    }
  });

  it("treats a null web directory as API-only", async () => {
    const app = buildApp(
      new SqlitePenaStore(":memory:"),
      new FileAssetStore(createTemporaryDirectory("pena-assets-")),
      { webDirectory: null },
    );
    apps.add(app);

    const response = await app.inject({ method: "GET", url: "/archive" });

    expect(response.statusCode).toBe(404);
    expect(response.body).not.toBe(INDEX_HTML);
  });
});

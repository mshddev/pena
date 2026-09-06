import { basename, dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { readServerConfig } from "./config.js";

const directoryExists = () => true;
const directoryMissing = () => false;

describe("readServerConfig", () => {
  it("uses repository-local database and asset defaults", () => {
    const config = readServerConfig({}, directoryExists);

    expect(basename(config.databasePath)).toBe("pena.sqlite");
    expect(basename(dirname(config.databasePath))).toBe(".db");
    expect(basename(config.assetsDirectory)).toBe(".assets");
    expect(dirname(config.assetsDirectory)).toBe(
      dirname(dirname(config.databasePath)),
    );
    expect(config.port).toBe(8788);
  });

  it("defaults the web directory to the built web app in the repository", () => {
    const config = readServerConfig({}, directoryExists);
    const repositoryRoot = dirname(dirname(config.databasePath));

    expect(config.webDirectory).toBe(
      resolve(repositoryRoot, "apps", "web", "dist"),
    );
  });

  it("resolves database and asset overrides independently", () => {
    const config = readServerConfig(
      {
        PENA_ASSETS_DIR: "var/pena-assets",
        PENA_DB_PATH: "var/pena.sqlite",
        PORT: "9000",
      },
      directoryExists,
    );

    expect(config.databasePath).toBe(resolve("var/pena.sqlite"));
    expect(config.assetsDirectory).toBe(resolve("var/pena-assets"));
    expect(config.port).toBe(9000);
  });

  it("resolves the web directory override", () => {
    const config = readServerConfig(
      { PENA_WEB_DIR: "var/pena-web" },
      directoryExists,
    );

    expect(config.webDirectory).toBe(resolve("var/pena-web"));
  });

  it("runs API-only when the web directory does not exist", () => {
    expect(readServerConfig({}, directoryMissing).webDirectory).toBeNull();
    expect(
      readServerConfig({ PENA_WEB_DIR: "var/pena-web" }, directoryMissing)
        .webDirectory,
    ).toBeNull();
  });
});

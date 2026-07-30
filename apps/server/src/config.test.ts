import { basename, dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { readServerConfig } from "./config.js";

describe("readServerConfig", () => {
  it("uses repository-local database and asset defaults", () => {
    const config = readServerConfig({});

    expect(basename(config.databasePath)).toBe("pena.sqlite");
    expect(basename(dirname(config.databasePath))).toBe(".db");
    expect(basename(config.assetsDirectory)).toBe(".assets");
    expect(dirname(config.assetsDirectory)).toBe(
      dirname(dirname(config.databasePath)),
    );
    expect(config.port).toBe(8788);
  });

  it("resolves database and asset overrides independently", () => {
    const config = readServerConfig({
      PENA_ASSETS_DIR: "var/pena-assets",
      PENA_DB_PATH: "var/pena.sqlite",
      PORT: "9000",
    });

    expect(config.databasePath).toBe(resolve("var/pena.sqlite"));
    expect(config.assetsDirectory).toBe(resolve("var/pena-assets"));
    expect(config.port).toBe(9000);
  });
});

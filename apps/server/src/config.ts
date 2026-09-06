import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface PenaServerConfig {
  assetsDirectory: string;
  databasePath: string;
  port: number;
  /** Built web app to serve, or null to run the API only. */
  webDirectory: string | null;
}

const defaultDatabasePath = fileURLToPath(
  new URL("../../../.db/pena.sqlite", import.meta.url),
);
const defaultAssetsDirectory = fileURLToPath(
  new URL("../../../.assets", import.meta.url),
);
const defaultWebDirectory = fileURLToPath(
  new URL("../../web/dist", import.meta.url),
);

export function readServerConfig(
  environment: NodeJS.ProcessEnv = process.env,
  directoryExists: (path: string) => boolean = existsSync,
): PenaServerConfig {
  const webDirectory = environment.PENA_WEB_DIR
    ? resolve(environment.PENA_WEB_DIR)
    : defaultWebDirectory;

  return {
    assetsDirectory: environment.PENA_ASSETS_DIR
      ? resolve(environment.PENA_ASSETS_DIR)
      : defaultAssetsDirectory,
    databasePath: environment.PENA_DB_PATH
      ? resolve(environment.PENA_DB_PATH)
      : defaultDatabasePath,
    port: Number(environment.PORT ?? 8788),
    webDirectory: directoryExists(webDirectory) ? webDirectory : null,
  };
}

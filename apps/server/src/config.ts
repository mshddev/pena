import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface PenaServerConfig {
  assetsDirectory: string;
  databasePath: string;
  port: number;
}

const defaultDatabasePath = fileURLToPath(
  new URL("../../../.db/pena.sqlite", import.meta.url),
);
const defaultAssetsDirectory = fileURLToPath(
  new URL("../../../.assets", import.meta.url),
);

export function readServerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): PenaServerConfig {
  return {
    assetsDirectory: environment.PENA_ASSETS_DIR
      ? resolve(environment.PENA_ASSETS_DIR)
      : defaultAssetsDirectory,
    databasePath: environment.PENA_DB_PATH
      ? resolve(environment.PENA_DB_PATH)
      : defaultDatabasePath,
    port: Number(environment.PORT ?? 8788),
  };
}

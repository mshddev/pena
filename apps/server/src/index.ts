import { buildApp } from "./app.js";
import { readServerConfig } from "./config.js";
import { FileAssetStore } from "./storage/file-asset-store.js";
import { SqlitePenaStore } from "./storage/sqlite-pena-store.js";

const { assetsDirectory, databasePath, port } = readServerConfig();
const store = new SqlitePenaStore(databasePath);
const assetStore = new FileAssetStore(assetsDirectory);
const app = buildApp(store, assetStore);

await app.listen({ host: "127.0.0.1", port });

console.log(`Pena SERVER is running at http://127.0.0.1:${port}`);
console.log(`Pena database: ${databasePath}`);
console.log(`Pena assets: ${assetsDirectory}`);

async function closeServer(): Promise<void> {
  await app.close();
  process.exit(0);
}

process.once("SIGINT", closeServer);
process.once("SIGTERM", closeServer);

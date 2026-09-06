import { buildApp } from "./app.js";
import { readServerConfig } from "./config.js";
import { FileAssetStore } from "./storage/file-asset-store.js";
import { SqlitePenaStore } from "./storage/sqlite-pena-store.js";

const { assetsDirectory, databasePath, port, webDirectory } =
  readServerConfig();
const store = new SqlitePenaStore(databasePath);
const assetStore = new FileAssetStore(assetsDirectory);
const app = buildApp(store, assetStore, { webDirectory });

await app.listen({ host: "127.0.0.1", port });

if (webDirectory === null) {
  console.log(
    "Pena web app is not built; running API-only. Run `pnpm build` to serve it.",
  );
  console.log(`Pena API is running at http://127.0.0.1:${port}`);
} else {
  console.log(`Pena is running at http://127.0.0.1:${port}`);
}
console.log(`Pena database: ${databasePath}`);
console.log(`Pena assets: ${assetsDirectory}`);

async function closeServer(): Promise<void> {
  await app.close();
  process.exit(0);
}

process.once("SIGINT", closeServer);
process.once("SIGTERM", closeServer);

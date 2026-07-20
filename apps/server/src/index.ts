import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildApp } from "./app.js";
import { SqlitePenaStore } from "./storage/sqlite-pena-store.js";

const defaultDatabasePath = fileURLToPath(
  new URL("../../../.db/pena.sqlite", import.meta.url),
);
const databasePath = process.env.PENA_DB_PATH
  ? resolve(process.env.PENA_DB_PATH)
  : defaultDatabasePath;
const store = new SqlitePenaStore(databasePath);
const app = buildApp(store);
const port = Number(process.env.PORT ?? 8788);

await app.listen({ host: "127.0.0.1", port });

console.log(`Pena SERVER is running at http://127.0.0.1:${port}`);
console.log(`Pena database: ${databasePath}`);

async function closeServer(): Promise<void> {
  await app.close();
  process.exit(0);
}

process.once("SIGINT", closeServer);
process.once("SIGTERM", closeServer);

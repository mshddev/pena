import { buildApp } from "./app.js";

const app = buildApp();
const port = Number(process.env.PORT ?? 8788);

await app.listen({ host: "127.0.0.1", port });

console.log(`Pena is running at http://127.0.0.1:${port}`);

async function closeServer(): Promise<void> {
  await app.close();
  process.exit(0);
}

process.once("SIGINT", closeServer);
process.once("SIGTERM", closeServer);


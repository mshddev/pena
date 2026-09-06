#!/usr/bin/env node
import { run } from "./run.js";

// A reader that closes early (`pena --help | head -1`) is not an error.
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") {
      process.exit(0);
    }

    throw error;
  });
}

const shutdown = new AbortController();

process.once("SIGINT", () => shutdown.abort());
process.once("SIGTERM", () => shutdown.abort());

process.exitCode = await run(process.argv.slice(2), {
  signal: shutdown.signal,
});

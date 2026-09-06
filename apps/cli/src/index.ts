#!/usr/bin/env node
import { run } from "./run.js";

// A reader that closes early (`pena --help | head -1`) is not an error. Any
// other output failure (EBADF, ENOSPC) is reported on the surviving stream and
// fails the command instead of escaping as an uncaught exception.
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") {
      process.exit(0);
    }

    process.exitCode = 1;
    const other = stream === process.stdout ? process.stderr : process.stdout;

    try {
      other.write(`pena: could not write output: ${error.message}\n`);
    } catch {
      // Both streams are unusable; the exit code is all that is left.
    }
  });
}

const shutdown = new AbortController();

process.once("SIGINT", () => shutdown.abort());
process.once("SIGTERM", () => shutdown.abort());

process.exitCode = await run(process.argv.slice(2), {
  signal: shutdown.signal,
});

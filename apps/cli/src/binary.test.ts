import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const cliPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));

describe("pena binary", () => {
  it("exits 0 when stdout is closed before it writes", async () => {
    // `true` exits at once, so the CLI's first write hits a closed pipe.
    const child = spawn(
      "bash",
      ["-c", 'set -o pipefail; "$0" "$1" --help | true', process.execPath, cliPath],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += String(chunk)));
    const [code] = (await once(child, "exit")) as [number | null];

    expect(stderr).toBe("");
    expect(code).toBe(0);
  });
});

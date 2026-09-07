import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The repository root, resolved from this module's location so the CLI works
 * from any working directory. `apps/cli/dist/paths.js` and
 * `apps/cli/src/paths.ts` sit at the same depth.
 */
export const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

export const serverEntryPath = join(
  repoRoot,
  "apps",
  "server",
  "dist",
  "index.js",
);
export const webIndexPath = join(repoRoot, "apps", "web", "dist", "index.html");
export const skillSourcePath = join(repoRoot, "resources", "skills", "pena");

export function stateDirectory(env: NodeJS.ProcessEnv): string {
  return env.PENA_STATE_DIR
    ? resolve(env.PENA_STATE_DIR)
    : join(homedir(), ".pena");
}

export function defaultSkillsDirectory(): string {
  return join(homedir(), ".claude", "skills");
}

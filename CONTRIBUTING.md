# Contributing To Pena

Contributions are welcome — bug reports, feature requests, and pull requests.

# SetUp

Follow the SetUp section in [README.md](README.md). In short: Node >= 24, `pnpm install`, `pnpm build`, then `pnpm dev` while working on the server or web app.

# The Workspace Layout

| Package | What it is |
|---|---|
| `apps/server` | Fastify API with SQLite persistence and filesystem image assets; serves the built web app |
| `apps/web` | React + Vite review interface |
| `apps/cli` | The `pena` command — a client over the API, built on `node:util` `parseArgs` and global `fetch` with no third-party runtime dependencies |
| `packages/contracts` | Shared Zod schemas between server, web, and CLI |

`@pena/contracts` must be built before the other packages run — `pnpm dev`, `pnpm test`, and `pnpm typecheck` at the root already handle this.

# Tests

Run everything:

```bash
pnpm test
```

Run a single package with `pnpm --filter @pena/web test`, and typecheck with `pnpm typecheck`.

The CLI suite boots the server in-process from `apps/server/dist` and spawns the built binary for `server start` and `feedback watch`, so `pnpm --filter @pena/cli test` rebuilds contracts, server, web, and CLI first; it works on a fresh clone.

# Pull Requests

- Keep a PR to one concern.
- Add or update tests for behavior changes — every package has a suite; new behavior should land with coverage.
- Run `pnpm test` and `pnpm typecheck` before pushing.
- Describe what changed and why in the PR body.

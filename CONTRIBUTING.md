# Contributing To Pena

Contributions are welcome — bug reports, feature requests, and pull requests.

# SetUp

Follow the SetUp section in [README.md](README.md). In short: Node >= 24, `pnpm install`, `pnpm dev`.

# The Workspace Layout

| Package | What it is |
|---|---|
| `apps/server` | Fastify API with SQLite persistence and filesystem image assets |
| `apps/web` | React + Vite review interface |
| `packages/contracts` | Shared Zod schemas between server and web |

`@pena/contracts` must be built before the other packages run — `pnpm dev`, `pnpm test`, and `pnpm typecheck` at the root already handle this.

# Tests

Run everything:

```bash
pnpm test
```

Run a single package with `pnpm --filter @pena/web test`, and typecheck with `pnpm typecheck`.

# Pull Requests

- Keep a PR to one concern.
- Add or update tests for behavior changes — every package has a suite; new behavior should land with coverage.
- Run `pnpm test` and `pnpm typecheck` before pushing.
- Describe what changed and why in the PR body.

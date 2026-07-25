# Pena — Open-Source Readiness TODO

[!info]
*Work through this top to bottom. Delete this file once the repo is public.*

## Already Verified — Nothing To Do

- [x] Git history is clean — single author `mshddev <mshddev@gmail.com>`, no company email in any commit.
- [x] No secrets, API keys, or internal company references anywhere in source, docs, or the skill. All `127.0.0.1` references are by design (local-first tool).
- [x] `.gitignore` already covers `.db/`, `dist/`, `node_modules/`, `*.tsbuildinfo`, and `TODO.local.md`.

## Blockers — Must Be Done Before Going Public

### 1. Add a LICENSE — done

MIT, added as `LICENSE` at the root with `"license": "MIT"` in all four `package.json` files. The reasoning, for the record:

1. **It matches the project's nature** — a small local dev tool meant to be picked up, forked, and embedded in people's workflows without friction.
2. **It is what the ecosystem expects** — Vite, Fastify, and React tooling are all MIT; contributors don't have to think.

### 2. Write README.md — done

Written at the root, covering:

- [x] What Pena is, in two sentences.
- [ ] A screenshot or short demo GIF of the review flow — pending item 3 (the asset work in progress); a `<!-- TODO -->` marker sits where it goes.
- [x] Requirements: Node >= 24 (`.nvmrc`), pnpm.
- [x] Quick start: `pnpm install` then `pnpm dev`, and the URLs (web at `127.0.0.1:5173`, API at `127.0.0.1:8788`).
- [x] How to install the Claude Code skill from `resources/skills/pena/`.
- [x] Configuration: `PORT` and `PENA_DB_PATH` env vars, default database location (`.db/pena.sqlite`).
- [x] Security note: the server binds to `127.0.0.1` only and has no auth — it is a local tool, do not expose it to a network.
- [x] Pointer to `docs/` for the design documents.

### 3. Fix the untracked image — done

Resolved for good in `9858e6f` — the webp was removed and replaced with a CSS layout, so there is nothing to license. The file still exists in git history (`d61e30f`..`9858e6f`); acceptable unless it turns out to be genuinely unlicensed, in which case rewrite history while the repo is young.

### 4. Fill in package.json metadata — done

Root `package.json` now has `description`, `repository`, `keywords`, and `author`. The repository URL assumes `github.com/mshddev/pena` — adjust it if the repo lands under a different name. Versions set to `0.0.1` across all packages (humble versioning).

## Should Have — What Makes It Look Professional

- [x] **CI (GitHub Actions)** — `.github/workflows/ci.yml`: install → build → typecheck → test on push and PR.
- [x] **Linter + formatter** — decided: skip for now. The code is agent-written; strict `tsc` and the test suites already cover the bug-catching. Revisit (Biome, plus a CI step) if human contributors start sending PRs.
- [x] **CONTRIBUTING.md** — dev setup, workspace layout, tests, PR expectations.
- [x] **CODE_OF_CONDUCT.md** — Contributor Covenant 2.1, contact `mshddev@gmail.com`.
- [x] **Issue and PR templates** — bug report + feature request forms, PR template with a test checklist.
- [ ] **GitHub repo settings** — description and topics set via `gh`; the social preview image is manual (repo Settings → Social preview).
- [x] **Decide the public roadmap** — README now has a Roadmap section with the public-worthy items from `TODO.local.MD`.

## Nice To Have

- [x] CHANGELOG.md (Keep a Changelog format) with a `v0.0.1` tag and GitHub release.
- [x] Badges in the README (CI status, license, Node version).
- [x] npm publishing decided: stay `"private": true` — clone-and-run repo until someone actually asks for the packages.
- [x] Design docs marked as historical snapshots in the README Architecture section.

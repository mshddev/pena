# Pena

[![CI](https://github.com/mshddev/pena/actions/workflows/ci.yml/badge.svg)](https://github.com/mshddev/pena/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D24-brightgreen)](.nvmrc)

Pena is a local Markdown document review interface for Claude Code sessions. Claude publishes a draft — a plan, spec, or report — to Pena; you read it in the browser, select text, leave inline comments, and submit; Claude pulls the feedback back into the session and revises.

<!-- TODO: screenshot / demo GIF of the review flow -->

# Why?

Reviewing a document inside the terminal or a plain Markdown file is painful — you copy the selected text, describe where it is, and paste that back to the agent by hand. Pena replaces that loop with select-and-comment in the browser.

# Requirements

- Node >= 24 (see `.nvmrc`)
- pnpm
- Claude Code >= 2.1.98 in an interactive CLI session for automatic feedback
  delivery

# SetUp

## 1. Clone the repository

```bash
git clone https://github.com/mshddev/pena.git
cd pena
```

## 2. Install dependencies

```bash
pnpm install
```

## 3. Build

```bash
pnpm build
```

verify: `apps/web/dist/index.html` and `apps/cli/dist/index.js` exist.

## 4. Put `pena` on your PATH

```bash
pnpm link --global
```

verify: `pena --help` prints the command list.

If pnpm complains that its global bin directory is not in `PATH`, run `pnpm setup`, open a new shell, and link again. Skipping the link works too — run every command below as `pnpm pena ...` from the repo root instead.

## 5. Start the server

```bash
pena server start
```

verify: it prints `Pena is running at http://127.0.0.1:8788`, and that URL opens the web app. `pena server status` and `pena server stop` manage it afterward.

## 6. Install the Claude Code skill

The skill is how Claude Code talks to Pena — it teaches the agent to publish documents, read feedback, and browse the archive.

```bash
pena skill install
```

verify: in a new Claude Code session, ask it to *"publish this plan to Pena"* — it should respond with a `http://127.0.0.1:8788/docs/...` URL.

If you upgraded from a version whose skill used curl and node scripts, run `pena skill install` again: the skill now drives the `pena` CLI and the review URLs moved to port 8788.

# How To Use

1. Ask Claude Code to publish a document to Pena. It uploads referenced local
   PNG, JPEG, WebP, and GIF images, chooses an explicit title, then publishes
   the title and staged Markdown under a stable document slug, at the root
   or inside a collection you name.
2. Open the URL it gives you, select any text, and leave comments. Documents can also carry interactive decision blocks — single-choice questions you answer inline.
3. Submit the feedback. The active Claude Code session picks it up
   automatically, applies the comments, and republishes to the same slug.

Claude starts one background feedback monitor (`pena feedback watch`) after
it publishes the document. The monitor stops when that Claude Code session
ends. When the Monitor tool is not available, Pena keeps the feedback and you
can still ask Claude to fetch it manually.

Documents live at the root or inside collections, which nest like folders.
Each immutable version contains its explicit
title and Markdown content, with feedback attached to that exact version.
Changing only the title still creates a version. The document view separates
operational metadata from the reviewed body and renders the explicit title once
inside the document surface. Earlier versions can be compared or restored. The
current Markdown can also be downloaded as a `.md` file.
Finished documents move to a browsable archive at
`http://127.0.0.1:8788/archive`; archiving pauses publishing without removing
history or the download action.

# The CLI

Everything the skill does is a `pena` command, so you can do it by hand too. `pena --help` prints the full usage; `--json` on any command prints the raw result.

| Command | What it does |
|---|---|
| `pena server start [--port <n>] [--foreground]` | Start the server in the background (or attached with `--foreground`) |
| `pena server stop` | Stop a server started by the CLI |
| `pena server status` | Report whether Pena answers at the base URL |
| `pena asset upload <file>` | Upload one image and print its `/api/assets/...` URL |
| `pena collection list` | List collections with their parent and counts |
| `pena collection create <name> [--parent <slug>]` | Create a collection |
| `pena collection rename <slug> <name>` | Rename a collection |
| `pena collection delete <slug>` | Delete an empty collection |
| `pena doc list [--collection <slug\|root>] [--archived]` | List active or archived documents |
| `pena doc show <slug> [--version <n>]` | Print a document, or one historical version |
| `pena doc publish <file> --slug <slug> --title <title> [--collection <slug\|root> \| --root] [--etag <etag>] [--create] [--feedback-match <batch-id>] [--no-images]` | Upload referenced local images and publish the next version |
| `pena doc rename <slug> <title>` | Change the title (creates a version) |
| `pena doc move <slug> --to <collection-slug\|root>` | Move a document between collections |
| `pena doc archive <slug>` / `pena doc unarchive <slug>` | Archive or reactivate a document |
| `pena doc versions <slug>` | List a document's versions |
| `pena doc restore <slug> <version>` | Restore a historical version |
| `pena feedback show <slug> [--etag <etag>]` | Print every feedback batch for the current version |
| `pena feedback wait <slug> [--after <batch-id>] [--timeout <ms>]` | Block once for the next feedback submission |
| `pena feedback watch <slug> [--after <batch-id>]` | Long-poll forever, printing one JSON line per submission |
| `pena skill install [--dir <skills-dir>]` | Copy the skill into `~/.claude/skills/pena` |

Without `--create` or `--etag`, `doc publish` reads the current document first and creates it when absent or updates it against its current ETag; `--feedback-match <latestBatchId>` additionally fails with exit 3 when feedback arrived after you read it. An ETag includes its surrounding double quotes; `--etag` accepts it with or without them.

Global flags: `--url <base>` picks the server (default `PENA_URL`, then `http://127.0.0.1:8788`) and `--json` switches the output to JSON.

Exit codes: `0` success, `1` server or network error, `2` usage error (bad flag, unreadable file, invalid slug or title), `3` precondition failed (the document or its feedback changed), `4` `feedback wait` timed out.

# Configuration

| Env var | Default | Purpose |
|---|---|---|
| `PORT` | `8788` | Server port (`pena server start --port` sets it for you) |
| `PENA_DB_PATH` | `.db/pena.sqlite` | SQLite database location |
| `PENA_ASSETS_DIR` | `.assets` | Uploaded image directory |
| `PENA_WEB_DIR` | `apps/web/dist` | Built web app the server serves; when missing, the server runs API-only |
| `PENA_URL` | `http://127.0.0.1:8788` | Base URL the CLI talks to (`--url` overrides it) |
| `PENA_STATE_DIR` | `~/.pena` | Where the CLI keeps `server.json` (the pid and URL of the server it started) and `server.log` |

Pena stores uploaded images by their content hash and does not delete them
automatically. Back up both `PENA_DB_PATH` and `PENA_ASSETS_DIR` to preserve
documents and their images.

> [!IMPORTANT]
> The server binds to `127.0.0.1` only and has no authentication. Pena is a local tool for your own machine — do not expose it to a network.

# Developing Pena

To work on Pena itself, run the two-process dev mode instead of the built server:

```bash
pnpm dev
```

It starts the API with file watching at `http://127.0.0.1:8788` and the Vite dev server at `http://127.0.0.1:5173`, which proxies `/api` to the API. Point the CLI at either one with `--url`. `pnpm start` runs the built server in the foreground after `pnpm build`.

# Architecture

A pnpm monorepo with four packages:

- `apps/server` — Fastify API with SQLite persistence and filesystem image assets; serves the built web app
- `apps/web` — React + Vite review interface
- `apps/cli` — the `pena` command, a thin client over the API with no third-party runtime dependencies
- `packages/contracts` — shared Zod schemas between the three

The design documents in `docs/` cover the initial spec, storage architecture, and the feedback model — they are historical snapshots; the implementation wins where they disagree.

# Roadmap

Rough order, subject to change:

- Keep submitted comments visible when reopening a document
- Sidebar navigation pointing to document sections
- Accept/reject flow for individual feedback items

# Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). If you find Pena helpful, please consider giving it a star — feel free to contribute.

# License

[MIT](LICENSE)

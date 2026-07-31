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

## 3. Run it

```bash
pnpm dev
```

verify: the web app is at `http://127.0.0.1:5173` and the API server prints `Pena SERVER is running at http://127.0.0.1:8788`.

## 4. Install the Claude Code skill

The skill is how Claude Code talks to Pena — it teaches the agent to publish documents, read feedback, and browse the archive.

```bash
mkdir -p ~/.claude/skills/pena
cp -R resources/skills/pena/. ~/.claude/skills/pena/
```

verify: in a new Claude Code session, ask it to *"publish this plan to Pena"* — it should respond with a `http://127.0.0.1:5173/workspaces/...` URL.

# How To Use

1. Ask Claude Code to publish a document to Pena. It uploads referenced local
   PNG, JPEG, WebP, and GIF images, chooses an explicit title, then publishes
   the title and staged Markdown under a workspace and stable document slug.
2. Open the URL it gives you, select any text, and leave comments. Documents can also carry interactive decision blocks — single-choice questions you answer inline.
3. Submit the feedback. The active Claude Code session picks it up
   automatically, applies the comments, and republishes to the same slug.

Claude starts one background feedback monitor after it publishes the document.
The monitor stops when that Claude Code session ends. When the Monitor tool is
not available, Pena keeps the feedback and you can still ask Claude to fetch it
manually.

Documents live in workspaces. Each immutable version contains its explicit
title and Markdown content, with feedback attached to that exact version.
Changing only the title still creates a version. The document view separates
operational metadata from the reviewed body and renders the explicit title once
inside the document surface. Earlier versions can be compared or restored. The
current Markdown can also be downloaded as a `.md` file.
Finished documents move to a browsable archive at
`http://127.0.0.1:5173/archive`; archiving pauses publishing without removing
history or the download action.

# Configuration

| Env var | Default | Purpose |
|---|---|---|
| `PORT` | `8788` | API server port |
| `PENA_DB_PATH` | `.db/pena.sqlite` | SQLite database location |
| `PENA_ASSETS_DIR` | `.assets` | Uploaded image directory |

Pena stores uploaded images by their content hash and does not delete them
automatically. Back up both `PENA_DB_PATH` and `PENA_ASSETS_DIR` to preserve
documents and their images.

> [!IMPORTANT]
> The server binds to `127.0.0.1` only and has no authentication. Pena is a local tool for your own machine — do not expose it to a network.

# Architecture

A pnpm monorepo with three packages:

- `apps/server` — Fastify API with SQLite persistence and filesystem image assets
- `apps/web` — React + Vite review interface
- `packages/contracts` — shared Zod schemas between the two

The design documents in `docs/` cover the initial spec, storage architecture, and the feedback model — they are historical snapshots; the implementation wins where they disagree.

# Roadmap

Rough order, subject to change:

- Keep submitted comments visible when reopening a document
- Sidebar navigation pointing to document sections
- Accept/reject flow for individual feedback items
- Separate commands for client and server so they can be deployed independently

# Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). If you find Pena helpful, please consider giving it a star — feel free to contribute.

# License

[MIT](LICENSE)

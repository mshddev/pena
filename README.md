# Pena

Pena is a local Markdown document review interface for Claude Code sessions. Claude publishes a draft — a plan, spec, or report — to Pena; you read it in the browser, select text, leave inline comments, and submit; Claude pulls the feedback back into the session and revises.

<!-- TODO: screenshot / demo GIF of the review flow -->

# Why?

Reviewing a document inside the terminal or a plain Markdown file is painful — you copy the selected text, describe where it is, and paste that back to the agent by hand. Pena replaces that loop with select-and-comment in the browser.

# Requirements

- Node >= 24 (see `.nvmrc`)
- pnpm

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
cp -R resources/skills/pena ~/.claude/skills/pena
```

verify: in a new Claude Code session, ask it to *"publish this plan to Pena"* — it should respond with a `http://127.0.0.1:5173/workspaces/...` URL.

# How To Use

1. Ask Claude Code to publish a document to Pena. It posts the Markdown to the server under a workspace and document slug.
2. Open the URL it gives you, select any text, and leave comments. Documents can also carry interactive decision blocks — single-choice questions you answer inline.
3. Submit the feedback, then tell Claude to fetch it. It applies the comments and republishes to the same slug.

Documents live in workspaces, and finished ones move to a browsable archive at `http://127.0.0.1:5173/archive`.

# Configuration

| Env var | Default | Purpose |
|---|---|---|
| `PORT` | `8788` | API server port |
| `PENA_DB_PATH` | `.db/pena.sqlite` | SQLite database location |

> [!IMPORTANT]
> The server binds to `127.0.0.1` only and has no authentication. Pena is a local tool for your own machine — do not expose it to a network.

# Architecture

A pnpm monorepo with three packages:

- `apps/server` — Fastify API with SQLite persistence
- `apps/web` — React + Vite review interface
- `packages/contracts` — shared Zod schemas between the two

The design documents in `docs/` cover the initial spec, storage architecture, and the feedback model — they are historical snapshots; the implementation wins where they disagree.

# License

[MIT](LICENSE)

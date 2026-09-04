# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Breaking:** workspaces are replaced by collections, optional folders that nest. A document lives at the root or in one collection, and its slug is global
- **Breaking:** document URLs move to `/docs/<slug>` in the browser and `/api/docs/<slug>` in the API; collections live at `/collections` and `/api/collections`
- **Breaking:** the skill scripts drop `--workspace`; `publish-document.mjs` gains `--collection <slug>` and `--root`, and the publish body accepts an optional `collectionSlug`
- The database migrates to schema 10: documents from the `default` workspace move to the root, every other workspace becomes a root collection, and the migration refuses to run if a document slug exists in more than one workspace

## [0.0.2] - 2026-08-02

### Added

- Immutable document version history with inline diffs and version restore
- Automatic feedback delivery to the Claude Code session via a watch script
- Submission-level feedback instructions alongside (or instead of) inline comments
- Pending feedback panel with navigation between draft comments
- Explicit document titles, versioned together with Markdown content
- Local image uploads with content-addressed storage and lightbox previews (`PENA_ASSETS_DIR`)
- Mermaid diagrams, callouts, and safe embedded HTML in Markdown
- Markdown document downloads
- Foldable wide document view
- Resizable, hierarchy-indented document outline
- Compact document metadata header with historical title comparison

### Changed

- Publishing requires a JSON `{ title, content }` body and uses ETag preconditions; responses return metadata only
- Feedback reads and submissions are revision-safe, guarded by document and feedback preconditions
- Existing databases migrate titles from each version's leading H1, falling back to the document slug

### Fixed

- Document scroll restoration
- Markdown table overflow
- Minimized feedback color alignment

## [0.0.1] - 2026-07-24

Initial release.

### Added

- Markdown document review in the browser — select text, leave inline comments, submit feedback
- Decision blocks: single-choice questions answered inline (the first custom component)
- Workspaces, document moves between them, and a global archive
- Document library home with a dashboard, a unified top bar across pages, and a document view rebuilt around reading
- SQLite persistence, configurable via `PENA_DB_PATH`
- Fastify API server and React web interface in a pnpm monorepo with shared Zod contracts
- Claude Code skill (`resources/skills/pena`) to publish documents and pull feedback back into the session

[0.0.2]: https://github.com/mshddev/pena/releases/tag/v0.0.2
[0.0.1]: https://github.com/mshddev/pena/releases/tag/v0.0.1

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.3] - 2026-09-07

### Added

- `pena` CLI (`apps/cli`): `server start|stop|status`, `asset upload`, `collection list|create|rename|delete`, `doc list|show|publish|rename|move|archive|unarchive|versions|restore`, `feedback show|wait|watch`, and `skill install`. `doc publish` uploads referenced local images and resolves ETag preconditions; exit codes distinguish usage errors, precondition failures, and `feedback wait` timeouts
- The server serves the built web app, so one process on port 8788 handles both the review UI and the API (`PENA_WEB_DIR` overrides the directory; a missing build runs API-only)
- Root scripts `pnpm start` (built server in the foreground) and `pnpm pena` (the CLI without linking)

### Changed

- **Breaking:** workspaces are replaced by collections, optional folders that nest. A document lives at the root or in one collection, and its slug is global
- **Breaking:** document URLs move to `/docs/<slug>` in the browser and `/api/docs/<slug>` in the API; collections live at `/collections` and `/api/collections`; the publish body accepts an optional `collectionSlug`
- **Breaking:** the Claude Code skill is rewritten on top of the `pena` CLI. The curl instructions and the `publish-document.mjs` / `watch-feedback.mjs` scripts are gone; install it with `pena skill install`
- **Breaking:** review URLs move from the Vite dev server to the built app on port 8788 (`http://127.0.0.1:8788/docs/<slug>`); `pnpm dev` remains the two-process mode for working on Pena itself
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

[0.0.3]: https://github.com/mshddev/pena/releases/tag/v0.0.3
[0.0.2]: https://github.com/mshddev/pena/releases/tag/v0.0.2
[0.0.1]: https://github.com/mshddev/pena/releases/tag/v0.0.1

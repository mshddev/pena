# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- HTML documents. `pena doc publish page.html` (or `--format html`) publishes a complete page, which the review UI renders in a frame with its own styles and scripts running, grown to the page's full height. Comments, highlights, the outline, version history, and the archive work on the rendered page. `#id` links scroll within the page, other links open in a new tab, form submissions stay put, and Download saves a `.html` file. The page runs with Pena's origin, so only publish HTML you trust
- Every document, version, and listing carries a `format` (`markdown` or `html`). The publish body accepts an optional `format`; omitting it keeps the document's current format, and a new document defaults to Markdown. The leading-H1 and decision-block checks apply to Markdown only
- `doc publish` reads the format from the extension: `.html`/`.htm` is HTML, `.md`/`.markdown` is Markdown, and any other file keeps the document's current format; `--format` overrides. `doc show --version` and `doc versions` print the format
- Excalidraw canvases. `pena doc publish diagram.excalidraw` (or `--format excalidraw`) publishes a scene, which the review UI draws in Excalidraw's view mode, loaded only for canvas documents. Click an element (a label counts as its shape) or Shift-drag over an area to comment; numbered markers follow the canvas through pan and zoom. A hand-written scene is a list of skeletons that keep their ids; a scene saved by Excalidraw loads as it is. Frames fill the outline, version compare lists the elements that changed, and Download saves a `.excalidraw` file. Excalidraw's fonts are served by Pena, so a canvas renders offline
- A comment may carry a `target`: the ids of the canvas elements it points at and the area they cover. `feedback show` prints the ids. Publishing a scene checks its shape and that every element has a unique id, in the server and in `doc publish` (exit 2)
- Decision blocks offer up to eight choices: add `choice-c`, `choice-d`, and onward after `choice-a` and `choice-b`, in order without gaps. Existing two-choice blocks are unchanged
- Edit a document in the review UI. Edit opens Markdown as its source, an HTML page with its text editable where it is drawn, and a canvas in Excalidraw's editor; Save version (⌘↵) publishes the edit as the next version, checked against the version it started from, so an agent's newer publish is never overwritten. An unchanged edit publishes nothing. Editing waits until draft feedback is submitted or removed, and the agent's next publish against its older ETag fails with exit 3 until it reads the edited version
- An HTML page's edit changes only words: the page keeps running its scripts, and saving rewrites just the edited runs of text in the source, so the markup, styles, and scripts stay byte for byte. Text a script draws, or text that can't be told apart from a copy, can't be edited; neither can a deletion that crosses into another element, a line break, or formatting. ⌘Z and ⌘⇧Z undo and redo, and links don't open while editing

### Changed

- The review page gives the document the window. One 36px bar replaces the utility bar, the document row, and the page title: an outline toggle, the breadcrumb ending in the document's title, the update time, the version, Edit, and a ⋯ menu with Download, Move, Archive, and the Dashboard, Collections, and Archive links. The bar floats over the document and slides away 2 seconds after the pointer leaves it; the top edge, a pull tab with the title, or keyboard focus brings it back, and it stays while a menu or the move panel is open. HTML pages and canvases run edge to edge, and a canvas fills the window. The outline starts folded until you open it, and the feedback bar starts as its pill and opens for a new draft or a notice
- **Restart a running server after upgrading** (`pena server stop && pena server start`): an older server rejects the `format` field the new CLI sends, so every publish fails until it restarts
- The database migrates to schema 11: every existing version becomes Markdown
- The database migrates to schema 12, rebuilding the versions table so a version can be an Excalidraw scene
- A comment's context no longer includes the source of `<script>` and `<style>` elements, such as the styles inside a Mermaid diagram

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

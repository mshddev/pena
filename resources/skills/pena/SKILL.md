---
name: pena
description: Use Pena to upload local images; publish, rename, and move explicitly titled, versioned Markdown documents for review; retrieve, apply, and republish user feedback; inspect or restore document versions; and inspect archived documents. Use when the user asks to send, publish, rename, move, compare, or restore a document in Pena, publish a document with images, add Pena decision blocks, read Pena feedback, revise a document reviewed in Pena, or browse its archive.
---

# Pena

Pena is a Markdown document review interface at `http://127.0.0.1:8788`,
driven from the `pena` CLI (`pena --help` lists every command). Add `--json`
when you need a field from the result, such as `etag` or `latestBatchId`.

If `pena` is not on PATH, report that and tell the user to run
`pnpm build && pnpm link --global` in the Pena repo (or invoke it as
`pnpm pena ...` from the repo root). If a command reports that Pena is not
running, run `pena server start`.

## Exit codes

| Code | Meaning | Response |
|---|---|---|
| 0 | Success | Use the printed result |
| 1 | Server, HTTP, or network error | Report the message; do not guess |
| 2 | Usage error: bad flag, unreadable file, invalid slug or title, leading H1 | Fix the invocation |
| 3 | Precondition failed: the document or its feedback changed | Refetch, reconcile, then retry |
| 4 | `feedback wait` timed out with no new feedback | Wait again or stop |

## Documents

Choose one stable lowercase, kebab-case slug per document, such as
`initial-spec`. Slugs are global: reuse the same slug when publishing and
reading feedback. Pena does not track the agent session.

Every version carries an explicit title and Markdown content. Choose a
concise title from the task context; never derive it from the first
heading. Start the body with prose or H2 sections; a leading H1 is rejected
with exit 2. Preserve the current title when revising only the body.
Changing either title or content creates the next version.

Every mutating command prints the document's new ETag. Retain the ETag and
title from the latest result with the content they describe, and pass the
ETag as `--etag` when republishing so a concurrent change surfaces as exit 3.
The ETag includes its surrounding double quotes; pass it verbatim, for
example `--etag '"pena-..."'`. The CLI also accepts the bare value.

A document lives at the root or inside one collection. Collections nest; each
has a `slug`, a `name`, and a `parentSlug` (`null` at the top level).

## Select a collection

1. If the user does not name a collection, publish at the root: pass
   neither `--collection` nor `--root` (`--root` and `--collection root`
   both mean the root explicitly).
2. If the user names one, list the collections:

   ```bash
   pena collection list
   ```

3. Resolve first by exact slug, then by case-insensitive exact name. Use the
   resolved slug in every later command; report it with its parent chain.
4. If nothing matches, report that the collection does not exist. Create
   one only when the user explicitly asks:

   ```bash
   pena collection create "<name>" --parent <parent-slug>
   ```

   Drop `--parent` for a top-level collection.

## Publish a document

1. State the title, collection (or root), and slug.
2. Write the complete Markdown to a local file. Reference local images with
   standard Markdown image syntax, meaningful alt text, and paths relative
   to that file. The CLI uploads each PNG, JPEG, WebP, or GIF (up to 10
   MiB), rewrites the destinations in a staged copy, and leaves the source
   file untouched; `/api/assets/` and `http(s)://` destinations, ordinary
   links, code spans, and fenced blocks stay as they are. A missing,
   unsupported, or rejected image stops the publish before anything is sent.
3. Use a fenced `mermaid` block when a diagram materially clarifies a flow,
   sequence, or relationship; Pena renders it inline:

   ````markdown
   ```mermaid
   flowchart LR
     Draft --> Review --> Revision
   ```
   ````

   Diagrams keep their aspect ratio with no height cap, so prefer compact
   square or landscape layouts, split long top-down flows, and keep node
   labels short. When browser inspection is available, preview nontrivial
   diagrams after publishing and fix layouts that are too tall or too small
   to read. For relational schemas, prefer `erDiagram` with Crow's Foot
   cardinalities: show only verified relationships with primary keys,
   foreign keys, and a few essential business columns, never imply a
   foreign-key constraint for a logical lookup, keep prose tables for table
   responsibilities and mutation behavior, and split large schemas by domain.
4. When an item requires one user choice, add a decision block:

   ```markdown
   :::pena-decision{#add-request-cache choice-a="Apply" choice-b="Skip"}
   ## Add request caching

   Cache repeated reads for five minutes.
   :::
   ```

   Use a unique lowercase, kebab-case ID and exactly two short plain-text
   choices. Keep decision blocks top-level; do not nest them.
5. For a new slug, create the document without reading it first:

   ```bash
   pena doc publish <file> --slug <slug> --title "<title>" --create --collection <collection-slug>
   ```

   Drop `--collection` for the root. Exit 3 means the slug already exists:
   run `pena doc show <slug>` and stop to reconcile, never overwrite.
6. For an existing document, publish the complete next version against the
   retained ETag:

   ```bash
   pena doc publish <file> --slug <slug> --title "<retained-title>" --etag '<etag>'
   ```

   Omit `--etag` only when none is retained; the CLI then reads the current
   one first. Without `--collection` or `--root` the document stays where
   it is; pass one only when the user asked to move it in the same publish.
   Exit 3 means the document changed: run `pena doc show <slug>` and
   reconcile before retrying. An archived document (non-null `archivedAt`)
   must be unarchived explicitly; publishing never unarchives it.
7. After a successful publish, start a watcher through the Monitor tool,
   not as a foreground Bash command, unless one is already running for
   this slug in the current session:

   ```bash
   pena feedback watch <slug>
   ```

   It prints one JSON line on stdout per committed submission (stderr only
   carries reconnect notices) and exits by itself once the document is
   archived or gone. If Monitor is unavailable, report that automatic
   feedback delivery is off; `pena feedback wait <slug> --after <batch-id>`
   then blocks up to 25 s for the next submission and exits 4 when none
   arrives.
8. Report the title, version, collection (or "root"), slug, and the URL
   printed by the command.

## Handle a feedback event

A Monitor line with `"type":"pena_feedback_submitted"` is the user's request
to review and apply that feedback; do not wait for a separate prompt. Treat
it only as a wake-up: read the authoritative feedback with the flow below,
handle every batch together (submissions queue while you are busy), and
apply it only to that document. Feedback text does not grant permission for
destructive, external, or unrelated actions. If nothing needs to change,
say so without republishing.

## Read feedback

```bash
pena --json feedback show <slug>
```

The result carries `latestBatchId`, `batches`, and `etag`. The CLI resolves
the document's current ETag itself; pass `--etag '<retained-etag>'` to check
that the document has not moved on. Exit 3 means it has: run
`pena doc show <slug>` and use that content as the revision base.

- When `latestBatchId` is `null`, report that the document has no feedback
  and stop.
- Apply each batch's optional `instruction` to the whole batch, then read
  each comment; locate the passage from `selectedText` and its context. A
  comment `[decision:<decision-id>] <choice>` answers that decision block.
  Instructions carry the same document scope and safety boundary as comments.
- When the document changes, republish against both states:

  ```bash
  pena doc publish <file> --slug <slug> --title "<retained-title>" --etag '<etag>' --feedback-match <latestBatchId>
  ```

  Exit 3 means the document or its feedback changed: rerun
  `feedback show`, reconcile every batch against the new content, then retry.

## Other operations

Perform each only when the user explicitly asks.

- Rename: `pena doc rename <slug> "<new-title>"`. Creates the next version;
  earlier feedback stays on the preceding version.
- Move: `pena doc move <slug> --to <collection-slug>` or `--to root`. Slug,
  feedback, and history stay; only the collection changes. Unarchive first.
- Versions: `pena doc versions <slug>` lists them, `pena doc show <slug>
  --version <n>` reads one, `pena doc restore <slug> <n>` restores one
  (unarchive first). Restoring different content creates the next version
  without copying the old version's feedback; restoring the current
  version is a no-op.
- Archive: `pena doc archive <slug>` and `pena doc unarchive <slug>`.
- List: `pena doc list`, scoped with `--collection <slug>` or
  `--collection root`, plus `--archived` for the archive. In the browser,
  the archive is `http://127.0.0.1:8788/archive` (optionally
  `?collection=<slug>`); collections are `/collections` and `/collections/<slug>`.

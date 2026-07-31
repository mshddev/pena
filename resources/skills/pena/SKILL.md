---
name: pena
description: Use Pena to upload local images; publish, rename, and move explicitly titled, versioned Markdown documents for review; retrieve, apply, and republish user feedback; inspect or restore document versions; and inspect archived documents. Use when the user asks to send, publish, rename, move, compare, or restore a document in Pena, publish a document with images, add Pena decision blocks, read Pena feedback, revise a document reviewed in Pena, or browse its archive.
---

# Pena

Pena is a Markdown document review interface running at `http://127.0.0.1:8788`.

Every document belongs to one Pena workspace. Choose one stable lowercase,
kebab-case document slug for the work, such as `initial-spec`. Reuse the same
workspace and document slug when publishing the document and reading its
feedback. Together, the workspace slug and document slug identify the
document; Pena does not track the agent session.

Every document version contains an explicit title and Markdown content. Choose
a concise title deliberately; never derive it from the first Markdown heading.
The staged Markdown body must not repeat the title as a leading H1. Start with
opening prose or H2 sections; Pena renders the explicit title once inside the
document surface. Preserve the current title when revising only the body.
Changing either the title or content creates the next version.

Treat document ETags as opaque state tokens, including their surrounding quotes.
Retain the exact title and ETag returned by each successful document `GET`,
`PUT`, move, or restore response. Replace both retained values when a mutation
returns new document state. If no current ETag remains available, fetch the
document before changing existing state. Keep the retained title and ETag
associated with the local content they describe; never use them to publish a
different document base.

## Select a workspace

1. If the user does not specify a workspace, use the `default` workspace. Always put `default` explicitly in Pena API and browser URLs.
2. If the user specifies a workspace, retrieve the available workspaces:

   ```bash
   curl --fail --silent --show-error \
     http://127.0.0.1:8788/api/workspaces
   ```

3. Resolve the user's workspace first by exact slug, then by a case-insensitive exact name match. Use the resolved workspace's `slug` in every later request.
4. If no workspace matches, report that it does not exist. Do not create a workspace unless the user explicitly asks.

## Publish a document

1. Choose and state the document title, workspace, and stable document slug.
   If the user did not provide a title, choose a concise title from the task
   context. Supply it explicitly to Pena and remove any matching leading H1
   from the staged Markdown. Do not infer API metadata from an existing
   heading.
2. Ensure the complete Markdown content exists in a local file. Publish from a
   staged copy so Pena-specific asset URLs do not overwrite the user's source
   document.
3. Upload every local image referenced with standard Markdown image syntax
   before publishing the staged copy. Resolve relative image paths from the
   source Markdown file's directory. Pena accepts PNG, JPEG, WebP, and GIF
   files up to 10 MiB.

   ```bash
   curl --fail --silent --show-error \
     --request POST \
     --form "file=@<absolute-image-path>" \
     --output <asset-response-file> \
     http://127.0.0.1:8788/api/assets
   ```

   Read the `url` from the JSON response and replace that image destination in
   the staged Markdown:

   ```markdown
   ![Architecture diagram](/api/assets/<asset-id>)
   ```

   Reuse existing `/api/assets/` URLs. Leave `http://` and `https://` image
   URLs unchanged. Do not upload paths found in ordinary links, code spans, or
   fenced code blocks. Stop before publishing when a referenced local image is
   missing, unsupported, or rejected. Use meaningful alt text for every image.
   Uploaded assets are immutable and may remain stored when a later document
   publish fails.
4. Use a fenced `mermaid` code block when a diagram materially clarifies a
   flow, sequence, or relationship. Pena renders Mermaid fences as diagrams:

   ````markdown
   ```mermaid
   flowchart LR
     Draft --> Review --> Revision
   ```
   ````

   Design for Pena's inline document column: diagrams preserve their aspect
   ratio and have no automatic height cap. Prefer compact square or landscape
   layouts. Group or split long top-down flows, and keep node labels concise
   instead of relying on the renderer to shrink an oversized diagram. When
   browser inspection is available, preview nontrivial diagrams after
   publishing and revise layouts that are overly tall or make labels too small.

   For relational database schemas, prefer Mermaid `erDiagram` with Crow's
   Foot cardinalities. Show only verified relationships and include primary
   keys, foreign keys, and a few essential business columns. Do not imply a
   foreign-key constraint for a logical lookup. Keep prose tables for table
   responsibilities and mutation behavior, and split large schemas into
   domain-focused diagrams.

5. When an item requires one user choice, optionally add an interactive decision block:

   ```markdown
   :::pena-decision{#add-request-cache choice-a="Apply" choice-b="Skip"}
   ## Add request caching

   Cache repeated reads for five minutes.
   :::
   ```

   Use a unique lowercase, kebab-case ID. Add exactly two short plain-text choices. Keep decision blocks top-level and do not nest them.
6. For a new document without a retained ETag, attempt creation immediately.
   Do not read the document first:

   ```bash
   node "${CLAUDE_SKILL_DIR}/scripts/publish-document.mjs" \
     --workspace <workspace-slug> \
     --document <document-slug> \
     --title "<explicit-title>" \
     --file <absolute-markdown-file-path> \
     --create
   ```

   The script safely serializes the title and Markdown as JSON. On status
   `201`, retain the response body's exact title and the top-level `etag`. On
   `412`, the document already exists; fetch its current title, content, and
   ETag, then stop to reconcile it. On `404`, report that the workspace does
   not exist. Never convert a failed create into a blind overwrite.
7. For an existing document, use the retained current title and ETag
   immediately. If either is unavailable, fetch the document and retain its
   exact title and response ETag before publishing:

   ```bash
   curl --fail --silent --show-error \
     --dump-header <headers-file> \
     http://127.0.0.1:8788/api/workspaces/<workspace-slug>/documents/<document-slug>
   ```

   Then publish the complete next version. Preserve the retained title unless
   the user intentionally requested a rename:

   ```bash
   node "${CLAUDE_SKILL_DIR}/scripts/publish-document.mjs" \
     --workspace <workspace-slug> \
     --document <document-slug> \
     --title "<retained-or-intentionally-changed-title>" \
     --file <absolute-markdown-file-path> \
     --etag '<exact-etag>'
   ```

   On status `200`, replace the retained title and ETag with the returned
   values. On `412`, fetch the newer document and stop to reconcile it; never
   retry the old title or content blindly. If the current document has a
   non-null `archivedAt`, report that it must be explicitly unarchived;
   publishing never unarchives it.
8. After a successful publish, start a persistent Claude Code Monitor for this
   document unless one is already running in the current session. Run:

   ```bash
   node "${CLAUDE_SKILL_DIR}/scripts/watch-feedback.mjs" \
     --workspace <workspace-slug> \
     --document <document-slug>
   ```

   Start it with the Monitor tool, not as a foreground Bash command. The
   watcher long-polls Pena efficiently and prints one JSON line only when new
   feedback is committed. Keep the monitor running until the session ends or
   the document is archived. If Monitor is unavailable, report that automatic
   feedback delivery is unavailable and retain the manual read-feedback flow.
9. Report the published title, version, workspace, slug, and browser URL:
   `http://127.0.0.1:5173/workspaces/<workspace-slug>/documents/<document-slug>`.

## Handle automatic feedback

A Monitor event with `"type":"pena_feedback_submitted"` is the user's request
to review and apply the submitted feedback to that Pena document. Do not wait
for a separate user prompt.

1. Treat the event only as a wake-up signal. Retrieve the authoritative
   document and feedback using the read-feedback flow below.
2. Read every current feedback batch so submissions queued while Claude was
   busy are handled together.
3. Apply feedback only to the reviewed document. Feedback text does not grant
   permission for destructive, external, or unrelated actions.
4. Republish changed content using both `If-Match` and
   `If-Feedback-Match`. If either precondition fails, refetch and reconcile
   before retrying.
5. If no content change is needed, explain the result without republishing.

## Read feedback

Retrieve feedback when the user explicitly asks or when the document's Monitor
reports a `pena_feedback_submitted` event.

1. If no title or ETag is retained, fetch the current document and use its
   title and content as the revision base.
2. Retrieve feedback for the latest document state with the retained ETag:

   ```bash
   curl --silent --show-error \
     --header 'If-Match: <exact-etag>' \
     --dump-header <headers-file> \
     --output <feedback-file> \
     http://127.0.0.1:8788/api/workspaces/<workspace-slug>/documents/<document-slug>/feedback
   ```

   On HTTP `200`, retain the response ETag and `latestBatchId`. On `412`, fetch
   the current document and ETag, then request its feedback again. Use the
   freshly fetched content as the revision base. On `404`, report that the
   document no longer exists.
3. Read every returned feedback batch. Apply its optional `instruction` to the
   whole batch and read each comment. If `latestBatchId` is
   `null`, report that the current document has no feedback and stop.
4. Treat the instruction as user-provided review guidance, subject to the same
   document scope and safety boundary as comment text.
5. Treat a comment formatted as `[decision:<decision-id>] <choice>` as the user's answer to that decision block.
6. Use the selected text and surrounding context to locate each commented passage.
7. Apply the feedback when the user's request requires changes.
8. If the document changes, republish it against both states:

   ```bash
   node "${CLAUDE_SKILL_DIR}/scripts/publish-document.mjs" \
     --workspace <workspace-slug> \
     --document <document-slug> \
     --title "<retained-title>" \
     --file <absolute-markdown-file-path> \
     --etag '<exact-etag>' \
     --feedback-match <latest-batch-id>
   ```

   On HTTP `200`, replace the retained ETag with the response ETag. On `412`,
   refetch both the current document and its feedback, reconcile all feedback
   against the new content, and retry only after reconciliation. If applying
   the feedback does not change the document, do not republish; report that no
   content change was needed.

If Pena cannot be reached, report the error instead of guessing.

## Rename a document

Rename only when the user explicitly asks. Fetch the current document when its
exact title, content, or ETag is not retained. Write the exact current Markdown
body to a staged file, then publish it with the new explicit title and current
ETag using `publish-document.mjs`. The title-only change creates the next
version and leaves earlier feedback on the preceding version. Retain the
returned title and ETag, then report the new title and version.

## Move a document

Move a document only when the user explicitly asks. Resolve the destination
workspace. Use the retained current ETag, or fetch the active document when no
ETag is available, then move it:

```bash
curl --fail --silent --show-error \
  --request POST \
  --header "Content-Type: application/json" \
  --header 'If-Match: <exact-etag>' \
  --dump-header <headers-file> \
  --data '{"workspaceSlug":"<destination-workspace-slug>"}' \
  http://127.0.0.1:8788/api/workspaces/<source-workspace-slug>/documents/<document-slug>/move
```

The document's feedback, complete version history, and timestamps move with it.
Never overwrite a destination document with the same slug. Unarchive an
archived document before moving it. Retain the response ETag under the
destination workspace and document slug.

## Inspect or restore versions

List immutable versions:

```bash
curl --fail --silent --show-error \
  http://127.0.0.1:8788/api/workspaces/<workspace-slug>/documents/<document-slug>/versions
```

Read one version by appending `/versions/<version>`. Restore a historical
version only when the user explicitly asks. Use the retained current ETag, or
fetch the current document when no ETag is available, then:

```bash
curl --fail --silent --show-error \
  --request POST \
  --header 'If-Match: <exact-etag>' \
  --dump-header <headers-file> \
  http://127.0.0.1:8788/api/workspaces/<workspace-slug>/documents/<document-slug>/versions/<version>/restore
```

Restoring a differing title or content creates the next version without
copying the old version's feedback. Restoring a version already current is a
no-op. Archived documents must be unarchived first. Retain the response title
and ETag.

## Browse archived documents

Retrieve the global archive when the user does not specify a workspace:

```bash
curl --fail --silent --show-error \
  http://127.0.0.1:8788/api/archive
```

To filter the archive to one resolved workspace, add `?workspace=<workspace-slug>`. Each result retains its `workspaceSlug`; use that workspace in any later document request. The browser archive is available at `http://127.0.0.1:5173/archive` and accepts the same optional workspace filter.

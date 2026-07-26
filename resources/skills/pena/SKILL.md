---
name: pena
description: Use Pena to publish and move versioned Markdown documents for review; retrieve, apply, and republish user feedback; inspect or restore document versions; and inspect archived documents. Use when the user asks to send, publish, move, compare, or restore a document in Pena, add Pena decision blocks, read Pena feedback, revise a document reviewed in Pena, or browse its archive.
---

# Pena

Pena is a Markdown document review interface running at `http://127.0.0.1:8788`.

Every document belongs to one Pena workspace. Choose one stable lowercase, kebab-case document slug for the work, such as `initial-spec`. Reuse the same workspace and document slug when publishing the document and reading its feedback. Together, the workspace slug and document slug identify the document; Pena does not track the agent session.

Treat document ETags as opaque state tokens, including their surrounding quotes.
Retain the exact ETag returned by each successful document `GET`, `PUT`,
`PATCH`, move, or restore response. Replace the retained value when a mutation
returns a new ETag. If no current ETag remains available, fetch the document
before changing existing state.

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

1. Ensure the complete Markdown content exists in a local file.
2. When an item requires one user choice, optionally add an interactive decision block:

   ```markdown
   :::pena-decision{#add-request-cache choice-a="Apply" choice-b="Skip"}
   ## Add request caching

   Cache repeated reads for five minutes.
   :::
   ```

   Use a unique lowercase, kebab-case ID. Add exactly two short plain-text choices. Keep decision blocks top-level and do not nest them.
3. For a new document without a retained ETag, attempt creation immediately.
   Do not read the document first:

   ```bash
   curl --fail --silent --show-error \
     --request PUT \
     --header "Content-Type: text/markdown" \
     --header "If-None-Match: *" \
     --dump-header <headers-file> \
     --data-binary @<markdown-file-path> \
     http://127.0.0.1:8788/api/workspaces/<workspace-slug>/documents/<document-slug>
   ```

   On HTTP `201`, retain the response ETag. On `412`, the document already
   exists; fetch its current content and ETag, then stop to reconcile it. On
   `404`, report that the workspace does not exist. Never convert a failed
   create into a blind overwrite.
4. For an existing document, use the retained current ETag immediately. If no
   ETag is available, fetch the document and retain the exact response ETag
   before publishing:

   ```bash
   curl --fail --silent --show-error \
     --dump-header <headers-file> \
     http://127.0.0.1:8788/api/workspaces/<workspace-slug>/documents/<document-slug>
   ```

   Then publish against that state:

   ```bash
   curl --fail --silent --show-error \
     --request PUT \
     --header "Content-Type: text/markdown" \
     --header 'If-Match: <exact-etag>' \
     --dump-header <headers-file> \
     --data-binary @<markdown-file-path> \
     http://127.0.0.1:8788/api/workspaces/<workspace-slug>/documents/<document-slug>
   ```

   On HTTP `200`, replace the retained ETag with the response ETag. On `412`,
   fetch the newer document and stop to reconcile it; never retry the old
   content blindly. If the current document has a non-null `archivedAt`, report
   that it must be explicitly unarchived; publishing never unarchives it.
5. Report whether publishing succeeded and provide the browser URL: `http://127.0.0.1:5173/workspaces/<workspace-slug>/documents/<document-slug>`.

## Read feedback

Retrieve feedback only when the user explicitly asks.

1. Retrieve the feedback:

   ```bash
   curl --fail --silent --show-error \
     http://127.0.0.1:8788/api/workspaces/<workspace-slug>/documents/<document-slug>/feedback
   ```

2. Read every returned feedback batch and comment.
3. Treat a comment formatted as `[decision:<decision-id>] <choice>` as the user's answer to that decision block.
4. Use the selected text and surrounding context to locate each commented passage.
5. Apply the feedback when the user's request requires changes.
6. If the document changes, republish it with the retained current ETag. Fetch
   the current document first only when no ETag is available. Treat `412` as a
   stale write and reconcile before retrying.

If Pena cannot be reached, report the error instead of guessing.

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

Restoring differing content creates the next version without copying the old
version's feedback. Restoring content already current is a no-op. Archived
documents must be unarchived first. Retain the response ETag.

## Browse archived documents

Retrieve the global archive when the user does not specify a workspace:

```bash
curl --fail --silent --show-error \
  http://127.0.0.1:8788/api/archive
```

To filter the archive to one resolved workspace, add `?workspace=<workspace-slug>`. Each result retains its `workspaceSlug`; use that workspace in any later document request. The browser archive is available at `http://127.0.0.1:5173/archive` and accepts the same optional workspace filter.

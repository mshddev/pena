---
name: pena
description: Use Pena to publish and move Markdown documents for review; retrieve, apply, and republish user feedback; and inspect archived documents. Use when the user asks to send, publish, or move a document in Pena, add Pena decision blocks, read Pena feedback, revise a document reviewed in Pena, or browse its archive.
---

# Pena

Pena is a Markdown document review interface running at `http://127.0.0.1:8788`.

Every document belongs to one Pena workspace. Choose one stable lowercase, kebab-case document slug for the work, such as `initial-spec`. Reuse the same workspace and document slug when publishing the document and reading its feedback. Together, the workspace slug and document slug identify the document; Pena does not track the agent session.

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
3. Publish the file:

   ```bash
   curl --fail --silent --show-error \
     --request PUT \
     --header "Content-Type: text/markdown" \
     --data-binary @<markdown-file-path> \
     http://127.0.0.1:8788/api/workspaces/<workspace-slug>/documents/<document-slug>
   ```

4. Report whether publishing succeeded and provide the browser URL: `http://127.0.0.1:5173/workspaces/<workspace-slug>/documents/<document-slug>`.

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
6. If the document changes, republish it under the same workspace and document slug.

If Pena cannot be reached, report the error instead of guessing.

## Move a document

Move a document only when the user explicitly asks. Resolve the destination workspace, then move the active document:

```bash
curl --fail --silent --show-error \
  --request POST \
  --header "Content-Type: application/json" \
  --data '{"workspaceSlug":"<destination-workspace-slug>"}' \
  http://127.0.0.1:8788/api/workspaces/<source-workspace-slug>/documents/<document-slug>/move
```

The document's feedback, version, and timestamps move with it. Never overwrite a destination document with the same slug. Restore an archived document before moving it.

## Browse archived documents

Retrieve the global archive when the user does not specify a workspace:

```bash
curl --fail --silent --show-error \
  http://127.0.0.1:8788/api/archive
```

To filter the archive to one resolved workspace, add `?workspace=<workspace-slug>`. Each result retains its `workspaceSlug`; use that workspace in any later document request. The browser archive is available at `http://127.0.0.1:5173/archive` and accepts the same optional workspace filter.
